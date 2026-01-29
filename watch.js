/* global fetch, URL, crypto, navigator */

(function () {
  const $ = (sel) => document.querySelector(sel);

  function uid() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `sid_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function getParam(name) {
    try {
      return new URL(window.location.href).searchParams.get(name);
    } catch {
      return null;
    }
  }

  const videoId = String(getParam('vid') || getParam('videoId') || '').trim();
  const messageId = String(getParam('mid') || '').trim(); // appended by /t/click for internal links
  const sessionId = uid();

  const pill = $('#pillStatus');
  const err = $('#err');
  const playerCard = $('#playerCard');
  const info = $('#info');
  const title = $('#title');
  const desc = $('#desc');
  const video = $('#video');

  function setError(text) {
    if (pill) pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
    if (err) {
      err.style.display = '';
      err.textContent = text;
    }
  }

  function setStatus(text) {
    if (pill) pill.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${text}`;
  }

  function sendEvent(type, payload) {
    const body = JSON.stringify({
      mid: messageId,
      vid: videoId,
      sid: sessionId,
      type,
      t: safeNum(payload?.t),
      d: safeNum(payload?.d),
      p: safeNum(payload?.p)
    });

    // If we can't attribute to a CRM message, still let the page work.
    if (!messageId) return;

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/t/video', blob);
        return;
      }
    } catch {}

    fetch('/t/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  }

  async function loadVideoMeta() {
    if (!videoId) {
      setError('Missing video id. The link should look like: /watch.html?vid=VIDEO_ID');
      return;
    }

    setStatus('Loading video…');
    const res = await fetch('/api/v1/public/videos');
    if (!res.ok) throw new Error('Cannot load videos');
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data?.videos) ? data.videos : [];
    const v = list.find((x) => String(x?.id || '') === videoId);
    if (!v) throw new Error('Video not found');

    title.textContent = String(v.title || 'Video');
    desc.textContent = String(v.description || '');
    video.src = `/api/v1/public/videos/${encodeURIComponent(videoId)}/file`;

    playerCard.style.display = '';
    info.style.display = '';

    setStatus('Ready');
    sendEvent('PAGE_VIEW', { t: 0, d: 0, p: 0 });
  }

  let lastProgressAt = 0;
  function reportProgress(force) {
    if (!video) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 9000) return; // ~1 event per 9s
    lastProgressAt = now;

    const t = safeNum(video.currentTime || 0);
    const d = safeNum(video.duration || 0);
    const p = d > 0 ? clamp((t / d) * 100, 0, 100) : 0;
    sendEvent('PROGRESS', { t, d, p });
  }

  function wire() {
    $('#btnCopyLink')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setStatus('Link copied');
        setTimeout(() => setStatus('Ready'), 1200);
      } catch {
        setStatus('Copy failed');
        setTimeout(() => setStatus('Ready'), 1200);
      }
    });

    video?.addEventListener('play', () => {
      const t = safeNum(video.currentTime || 0);
      const d = safeNum(video.duration || 0);
      const p = d > 0 ? clamp((t / d) * 100, 0, 100) : 0;
      sendEvent('PLAY', { t, d, p });
      reportProgress(true);
    });

    video?.addEventListener('pause', () => {
      const t = safeNum(video.currentTime || 0);
      const d = safeNum(video.duration || 0);
      const p = d > 0 ? clamp((t / d) * 100, 0, 100) : 0;
      sendEvent('PAUSE', { t, d, p });
      reportProgress(true);
    });

    video?.addEventListener('ended', () => {
      const t = safeNum(video.currentTime || 0);
      const d = safeNum(video.duration || 0);
      sendEvent('ENDED', { t, d, p: 100 });
      reportProgress(true);
    });

    video?.addEventListener('timeupdate', () => reportProgress(false));
    window.addEventListener('pagehide', () => reportProgress(true));
    window.addEventListener('beforeunload', () => reportProgress(true));
  }

  (async function init() {
    try {
      wire();
      await loadVideoMeta();
    } catch (e) {
      setError(String(e?.message || e || 'Error'));
    }
  })();
})();

