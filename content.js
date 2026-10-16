// Adds a small download button under a YouTube video. One click saves the
// video's transcript as "<video title>.txt".

(function () {
  'use strict';

  const BUTTON_ID = 'ytTranscriptDownload';
  // Down-arrow into tray, same glyph as the Teams Downloader button
  const DL_PATH = 'M8 1.5a.75.75 0 0 1 .75.75v6.69l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 8.03a.75.75 0 1 1 1.06-1.06l1.97 1.97V2.25A.75.75 0 0 1 8 1.5Z M2.75 12a.75.75 0 0 1 .75.75v.75c0 .14.11.25.25.25h8.5a.25.25 0 0 0 .25-.25v-.75a.75.75 0 0 1 1.5 0v.75A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.5v-.75a.75.75 0 0 1 .75-.75Z';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function getVideoId() {
    return new URLSearchParams(location.search).get('v');
  }

  // Video title as a file name: only what Windows forbids is replaced
  function getVideoTitle() {
    const heading = document.querySelector('ytd-watch-metadata h1');
    const title = (heading && heading.textContent.trim()) ||
      document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
    return title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim() || 'transcript';
  }

  // Caption tracks listed in the watch page's player data. Fetched fresh
  // because YouTube changes videos without reloading the page.
  async function fetchCaptionTracks(videoId) {
    const html = await (await fetch('https://www.youtube.com/watch?v=' + videoId)).text();
    const parts = html.split('"captions":');
    if (parts.length < 2) return [];
    const captions = JSON.parse(parts[1].split(',"videoDetails')[0].replace('\n', ''));
    return captions.playerCaptionsTracklistRenderer.captionTracks || [];
  }

  // English written by a person, then auto-generated English, then whatever
  // the video has
  function pickTrack(tracks) {
    const english = tracks.filter(t => t.languageCode.startsWith('en'));
    return english.find(t => t.kind !== 'asr') || english[0] || tracks[0];
  }

  // YouTube only serves captions with a token that its own player generates.
  // Switching the player's subtitles on makes the player request captions, and
  // the token is read from that request's address.
  async function getPlayerToken() {
    const ccButton = document.querySelector('#movie_player .ytp-subtitles-button');
    if (!ccButton) return null;

    const wasOn = ccButton.getAttribute('aria-pressed') === 'true';
    if (wasOn) ccButton.click();
    // The browser stops recording requests once its list is full, so empty it first
    performance.clearResourceTimings();
    ccButton.click();

    let token = null;
    for (let waited = 0; waited <= 2000 && !token; waited += 50) {
      await sleep(50);
      const request = performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/api/timedtext?')).pop();
      if (request) token = new URL(request.name).searchParams.get('pot');
    }

    if (!wasOn) ccButton.click();
    return token;
  }

  async function fetchLines(track, token) {
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('c', 'WEB');
    if (token) url.searchParams.set('pot', token);

    const response = await fetch(url);
    const body = response.ok ? await response.text() : '';
    if (!body) return [];

    return (JSON.parse(body).events || [])
      .filter(event => event.segs)
      .map(event => event.segs.map(seg => seg.utf8).join('').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function saveText(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleClick(event) {
    const button = event.currentTarget;
    // The player hands out no caption token while an ad is on screen
    if (document.querySelector('#movie_player.ad-showing')) {
      alert('An ad is playing. Wait for it to finish, then click again.');
      return;
    }
    button.disabled = true;
    try {
      const tracks = await fetchCaptionTracks(getVideoId());
      if (!tracks.length) {
        alert('This video has no transcript.');
        return;
      }
      const lines = await fetchLines(pickTrack(tracks), await getPlayerToken());
      if (!lines.length) {
        alert('Could not get the transcript. Refresh the page and try again.');
        return;
      }
      saveText(lines.join('\n'), getVideoTitle() + '.txt');
    } catch (error) {
      console.error('[YouTube Transcript]', error);
      alert('Could not get the transcript: ' + error.message);
    } finally {
      button.disabled = false;
    }
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = 'Download transcript';
    button.setAttribute('aria-label', 'Download transcript');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', DL_PATH);
    svg.appendChild(path);
    button.appendChild(svg);

    button.addEventListener('click', handleClick);
    return button;
  }

  // Sits right after the Subscribe button under the video
  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const row = document.querySelector('ytd-watch-metadata #owner');
    if (row) row.appendChild(createButton());
  }

  // YouTube builds the page late and rebuilds it when moving between videos
  setInterval(injectButton, 1000);
})();
