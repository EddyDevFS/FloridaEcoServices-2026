(() => {
  const apiBase = (window.FECO?.API_BASE || 'http://localhost:3001').toString().replace(/\/+$/, '');

  const grid = document.getElementById('videoGrid');
  const empty = document.getElementById('emptyState');
  const refreshBtn = document.getElementById('refreshBtn');
  const loginBtn = document.getElementById('loginBtn');
  const thumbJumpBtn = document.getElementById('thumbJumpBtn');
  const uploadCard = document.getElementById('uploadCard');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadStatus = document.getElementById('uploadStatus');
  const titleEl = document.getElementById('videoTitle');
  const descEl = document.getElementById('videoDescription');
  const fileEl = document.getElementById('videoFile');

  const adminThumbnails = document.getElementById('adminThumbnails');
  const thumbTitleEl = document.getElementById('thumbTitle');
  const thumbFileEl = document.getElementById('thumbFile');
  const thumbUploadBtn = document.getElementById('thumbUploadBtn');
  const thumbUploadStatus = document.getElementById('thumbUploadStatus');
  const thumbRefreshBtn = document.getElementById('thumbRefreshBtn');
  const thumbList = document.getElementById('thumbList');
  const thumbEmpty = document.getElementById('thumbEmpty');

  const nowPlayingTitle = document.getElementById('nowPlayingTitle');
  const nowPlayingSub = document.getElementById('nowPlayingSub');

  const commentsGrid = document.getElementById('commentsGrid');
  const commentsEmpty = document.getElementById('commentsEmpty');
  const refreshCommentsBtn = document.getElementById('refreshCommentsBtn');
  const openCommentModalBtn = document.getElementById('openCommentModalBtn');
  const commentModal = document.getElementById('commentModal');
  const commentModalClose = document.getElementById('commentModalClose');
  const submitCommentBtn = document.getElementById('submitCommentBtn');
  const commentStatus = document.getElementById('commentStatus');
  const cFirstName = document.getElementById('cFirstName');
  const cLastName = document.getElementById('cLastName');
  const cCity = document.getElementById('cCity');
  const cEmail = document.getElementById('cEmail');
  const cPhone = document.getElementById('cPhone');
  const cComment = document.getElementById('cComment');

  const adminComments = document.getElementById('adminComments');
  const tabSeeded = document.getElementById('tabSeeded');
  const tabPublic = document.getElementById('tabPublic');
  const adminCommentsList = document.getElementById('adminCommentsList');
  const adminCommentsEmpty = document.getElementById('adminCommentsEmpty');
  const addSeededBtn = document.getElementById('addSeededBtn');
  const adminCommentStatus = document.getElementById('adminCommentStatus');
  const aFirstName = document.getElementById('aFirstName');
  const aLastName = document.getElementById('aLastName');
  const aCity = document.getElementById('aCity');
  const aDate = document.getElementById('aDate');
  const aComment = document.getElementById('aComment');

  let state = {
    me: null,
    videos: [],
    activeVideoId: null,
    adminTab: 'SEEDED'
  };

  let activePlayer = null;
  let activePlayerCard = null;

  function escapeHtml(value) {
    return (value || '')
      .toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function bytesLabel(n) {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let x = v;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function setHint(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#b91c1c' : kind === 'success' ? '#0b6b55' : '#64748b';
  }

  async function fetchThumbnails() {
    const res = await fetch(`${apiBase}/api/v1/public/thumbnails`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'load_failed');
    return Array.isArray(body?.thumbnails) ? body.thumbnails : [];
  }

  async function renderThumbnails() {
    if (!thumbList) return;
    thumbList.innerHTML = '';
    if (thumbEmpty) thumbEmpty.style.display = 'none';

    try {
      const items = await fetchThumbnails();
      if (!items.length) {
        if (thumbEmpty) thumbEmpty.style.display = '';
        return;
      }

      thumbList.innerHTML = items
        .map((t) => {
          const url = `${window.location.origin}/api/v1/public/thumbnails/${encodeURIComponent(t.id)}/file`;
          const title = String(t.title || '').trim() || `Thumbnail ${t.id}`;
          return `
            <div class="planning-item" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
              <div style="display:flex;gap:12px;align-items:center;min-width:260px;flex:1;">
                <img src="${url}" alt="" style="width:120px;height:68px;object-fit:cover;border-radius:12px;border:1px solid #e2e8f0;background:#fff;" />
                <div>
                  <div style="font-weight:900;">${escapeHtml(title)}</div>
                  <div class="field-hint" style="margin-top:4px;">${escapeHtml(url)}</div>
                </div>
              </div>
              <button class="btn-secondary" data-thumb-copy="${escapeHtml(url)}"><i class="fa-regular fa-copy"></i> Copy URL</button>
            </div>
          `;
        })
        .join('');

      thumbList.querySelectorAll('[data-thumb-copy]').forEach((b) => {
        b.addEventListener('click', async () => {
          const u = b.getAttribute('data-thumb-copy') || '';
          try {
            await navigator.clipboard.writeText(u);
            setHint(thumbUploadStatus, 'Copied.', 'success');
            setTimeout(() => setHint(thumbUploadStatus, '', 'info'), 900);
          } catch {
            setHint(thumbUploadStatus, 'Copy failed.', 'error');
          }
        });
      });
    } catch (e) {
      setHint(thumbUploadStatus, String(e?.message || e), 'error');
      if (thumbEmpty) thumbEmpty.style.display = '';
    }
  }

  async function refreshMe() {
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    try {
      const doMe = async (bearer) => {
        return fetch(`${apiBase}/api/v1/auth/me`, {
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          credentials: 'include'
        });
      };

      const refreshAccessToken = async () => {
        try {
          const r = await fetch(`${apiBase}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) return null;
          const next = (body?.accessToken || '').toString().trim();
          if (next) localStorage.setItem('feco.accessToken', next);
          return next || null;
        } catch {
          return null;
        }
      };

      let res = await doMe(token);
      if (res.status === 401) {
        const next = await refreshAccessToken();
        res = await doMe(next || '');
      }
      if (!res.ok) return null;
      const body = await res.json().catch(() => ({}));
      return body?.user || null;
    } catch {
      return null;
    }
  }

  function mountLoginModal() {
    if (document.getElementById('fecoLoginModal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'fecoLoginModal';
    overlay.style.cssText =
      'position:fixed; inset:0; background:rgba(2,8,23,.52); display:none; align-items:center; justify-content:center; padding:18px; z-index:20000;';
    overlay.innerHTML = `
      <div style="width:min(520px, 100%); background:#fff; border-radius:18px; border:1px solid rgba(15,23,42,.12); box-shadow:0 24px 80px rgba(0,0,0,.22); padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div style="font-weight:950;letter-spacing:-.01em;"><i class="fa-solid fa-lock"></i> Admin login</div>
          <button id="fecoLoginClose" class="btn-secondary" type="button"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div style="margin-top:12px; display:grid; gap:10px;">
          <div class="form-field" style="margin:0;">
            <label>Email</label>
            <input id="fecoLoginEmail" type="email" autocomplete="username" placeholder="you@domain.com">
          </div>
          <div class="form-field" style="margin:0;">
            <label>Password</label>
            <input id="fecoLoginPassword" type="password" autocomplete="current-password" placeholder="••••••••">
          </div>
          <div id="fecoLoginError" style="display:none; color:#b91c1c; font-weight:750; font-size:12px;"></div>
          <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn-secondary" id="fecoLoginLogout" type="button"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
            <button class="btn-primary" id="fecoLoginSubmit" type="button"><i class="fa-solid fa-right-to-bracket"></i> Login</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#fecoLoginClose')?.addEventListener('click', () => (overlay.style.display = 'none'));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });

    const emailEl = overlay.querySelector('#fecoLoginEmail');
    const pwEl = overlay.querySelector('#fecoLoginPassword');
    const errEl = overlay.querySelector('#fecoLoginError');
    const submit = overlay.querySelector('#fecoLoginSubmit');
    const logout = overlay.querySelector('#fecoLoginLogout');

    const showErr = (msg) => {
      if (!errEl) return;
      errEl.style.display = msg ? 'block' : 'none';
      errEl.textContent = msg || '';
    };

    logout?.addEventListener('click', async () => {
      try {
        await window.HMP_DB?.apiLogout?.();
        showErr('');
      } catch {}
    });

    submit?.addEventListener('click', async () => {
      const email = (emailEl?.value || '').trim();
      const password = pwEl?.value || '';
      if (!email || !password) return showErr('Email and password are required.');
      showErr('');
      submit.disabled = true;
      try {
        localStorage.setItem('feco.lastEmail', email);
        await window.HMP_DB?.apiLogin?.(email, password);
        overlay.style.display = 'none';
        await bootstrap();
      } catch (e) {
        showErr(String(e?.message || e));
      } finally {
        submit.disabled = false;
        if (pwEl) pwEl.value = '';
      }
    });
  }

  function ensureLogin() {
    mountLoginModal();
    const overlay = document.getElementById('fecoLoginModal');
    if (!overlay) return;
    const email = localStorage.getItem('feco.lastEmail') || '';
    const emailEl = overlay.querySelector('#fecoLoginEmail');
    if (emailEl && !emailEl.value) emailEl.value = email;
    overlay.style.display = 'flex';
  }

  function openCommentModal() {
    if (!commentModal) return;
    commentModal.style.display = 'flex';
    commentModal.setAttribute('aria-hidden', 'false');
    setHint(commentStatus, '', 'info');
    setTimeout(() => {
      try {
        cFirstName?.focus?.();
      } catch {}
    }, 10);
  }

  function closeCommentModal() {
    if (!commentModal) return;
    commentModal.style.display = 'none';
    commentModal.setAttribute('aria-hidden', 'true');
    setHint(commentStatus, '', 'info');
  }

  async function fetchVideos() {
    const res = await fetch(`${apiBase}/api/v1/public/videos`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'failed_to_load');
    return Array.isArray(body?.videos) ? body.videos : [];
  }

  function videoFileUrl(videoId) {
    return `${apiBase}/api/v1/public/videos/${encodeURIComponent(String(videoId))}/file`;
  }

  function stopActivePlayer() {
    try {
      if (activePlayer) {
        activePlayer.pause();
        activePlayer.removeAttribute('src');
        activePlayer.load();
        activePlayer.controls = false;
        activePlayer.style.display = 'none';
      }
    } catch {}
    try {
      if (activePlayerCard) {
        const img = activePlayerCard.querySelector('img[data-poster]');
        const overlay = activePlayerCard.querySelector('[data-play-overlay]');
        if (img) img.style.display = '';
        if (overlay) overlay.style.display = '';
      }
    } catch {}
    activePlayer = null;
    activePlayerCard = null;
  }

  function setActiveVideo(video, cardEl) {
    if (!video || !cardEl) return;
    const v = cardEl.querySelector('video[data-player]');
    if (!v) return;
    const img = cardEl.querySelector('img[data-poster]');
    const overlay = cardEl.querySelector('[data-play-overlay]');

    if (activePlayer && activePlayer !== v) stopActivePlayer();
    activePlayer = v;
    activePlayerCard = cardEl;

    try {
      if (img) img.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      v.style.display = 'block';
      v.controls = true;
      if (!v.src) v.src = videoFileUrl(video.id);
      v.currentTime = 0;
      v.play().catch(() => {});
    } catch {}

    state.activeVideoId = video.id;
    if (nowPlayingTitle) nowPlayingTitle.textContent = video?.title || video?.originalName || 'Video';
    if (nowPlayingSub) nowPlayingSub.textContent = video?.description || 'Playing…';

    refreshComments().catch(() => {});
    refreshAdminComments().catch(() => {});
    highlightActiveCard();
  }

  function highlightActiveCard() {
    if (!grid) return;
    grid.querySelectorAll('[data-video-id]').forEach((el) => {
      const id = el.getAttribute('data-video-id');
      el.style.outline = id === state.activeVideoId ? '3px solid rgba(11,107,85,0.55)' : '';
    });
  }

  function posterCacheKey(video) {
    const at = video?.createdAt ? String(video.createdAt) : '';
    return `feco.videoPoster.${String(video?.id || '')}.${at}`;
  }

  function setThumbPoster(cardEl, url) {
    const img = cardEl?.querySelector('img[data-poster]');
    if (img) img.src = url;
    const v = cardEl?.querySelector('video[data-player]');
    if (v) v.setAttribute('poster', url);
  }

  async function generatePoster(video, cardEl) {
    try {
      const key = posterCacheKey(video);
      const cached = localStorage.getItem(key);
      if (cached && cached.startsWith('data:image/')) {
        setThumbPoster(cardEl, cached);
        return;
      }

      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = videoFileUrl(video.id);

      const wait = (ev) =>
        new Promise((resolve, reject) => {
          const onOk = () => cleanup(resolve);
          const onFail = () => cleanup(() => reject(new Error('poster_failed')));
          const cleanup = (fn) => {
            v.removeEventListener(ev, onOk);
            v.removeEventListener('error', onFail);
            fn();
          };
          v.addEventListener(ev, onOk, { once: true });
          v.addEventListener('error', onFail, { once: true });
        });

      await wait('loadedmetadata');
      const target = Math.min(1.0, Math.max(0, (v.duration || 0) * 0.05));
      try {
        v.currentTime = target;
      } catch {}
      await wait('seeked');

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      if (dataUrl && dataUrl.startsWith('data:image/')) {
        setThumbPoster(cardEl, dataUrl);
        try {
          localStorage.setItem(key, dataUrl);
        } catch {}
      }
    } catch {}
  }

  async function renderVideos(videos) {
    if (!grid) return;
    grid.innerHTML = '';
    if (empty) empty.style.display = 'none';
    state.videos = videos;

    if (!videos.length) {
      if (empty) empty.style.display = '';
      return;
    }

    grid.innerHTML = videos
      .map((v) => {
        const t = escapeHtml(v.title || v.originalName || 'Video');
        const d = escapeHtml(v.description || '');
        const date = v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '';
        return `
        <div class="video-card" data-video-id="${escapeHtml(v.id)}" role="button" tabindex="0" aria-label="Play ${t}">
          <div class="video-thumb">
            <img data-poster alt="" src="data:image/svg+xml,${encodeURIComponent(
              `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0b1220'/><text x='50%' y='50%' fill='rgba(255,255,255,.72)' font-family='system-ui,Segoe UI,Roboto' font-size='18' text-anchor='middle'>Loading preview…</text></svg>`
            )}">
            <video data-player playsinline preload="none"></video>
            <div class="video-play">
              <span class="play-badge" data-play-overlay><i class="fa-solid fa-play"></i> Play</span>
            </div>
          </div>
          <div style="margin-top:10px;">
            <h3>${t}</h3>
            ${d ? `<p>${d}</p>` : `<p style="opacity:.7;">No description</p>`}
            <div class="video-meta">
              <span><i class="fa-regular fa-clock"></i> ${escapeHtml(date || '—')}</span>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    grid.querySelectorAll('[data-video-id]').forEach((el) => {
      const id = el.getAttribute('data-video-id');
      const v = videos.find((x) => x.id === id);
      if (v) generatePoster(v, el);

      const activate = () => {
        const vid = videos.find((x) => x.id === id);
        if (vid) setActiveVideo(vid, el);
      };

      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') activate();
      });

      const playerEl = el.querySelector('video[data-player]');
      playerEl?.addEventListener('click', (e) => e.stopPropagation());
      playerEl?.addEventListener('ended', () => {
        if (state.activeVideoId === id) stopActivePlayer();
      });
    });

    if (!state.activeVideoId) {
      if (nowPlayingTitle) nowPlayingTitle.textContent = 'Select a video';
      if (nowPlayingSub) nowPlayingSub.textContent = 'Tap a card below to start playing. Only one video plays at a time.';
    } else {
      highlightActiveCard();
    }
  }

  async function fetchComments(videoId) {
    const res = await fetch(`${apiBase}/api/v1/public/videos/${encodeURIComponent(String(videoId))}/comments`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'failed_to_load_comments');
    return Array.isArray(body?.comments) ? body.comments : [];
  }

  function renderComments(comments) {
    if (!commentsGrid) return;
    commentsGrid.innerHTML = '';
    if (commentsEmpty) commentsEmpty.style.display = 'none';

    if (!comments.length) {
      if (commentsEmpty) commentsEmpty.style.display = '';
      return;
    }

    commentsGrid.innerHTML = comments
      .map((c) => {
        const name = escapeHtml(c.name || 'Anonymous');
        const city = escapeHtml(c.city || '');
        const text = escapeHtml(c.comment || '');
        const initial = escapeHtml((c.name || 'A').trim().slice(0, 1).toUpperCase());
        return `
          <div class="comment-card">
            <div class="who">
              <div style="display:flex; gap:10px; align-items:center;">
                <div class="avatar">${initial}</div>
                <div>
                  <strong>${name}</strong>
                  <div><small>${city}</small></div>
                </div>
              </div>
            </div>
            <div class="text">“${text}”</div>
          </div>
        `;
      })
      .join('');
  }

  async function refreshComments() {
    if (!state.activeVideoId) return;
    const comments = await fetchComments(state.activeVideoId);
    renderComments(comments);
  }

  async function submitComment() {
    if (!state.activeVideoId) return;
    const payload = {
      firstName: (cFirstName?.value || '').trim(),
      lastName: (cLastName?.value || '').trim(),
      city: (cCity?.value || '').trim(),
      email: (cEmail?.value || '').trim(),
      phone: (cPhone?.value || '').trim(),
      comment: (cComment?.value || '').trim()
    };
    if (!payload.firstName || !payload.lastName || !payload.city || !payload.email || !payload.phone || !payload.comment) {
      return setHint(commentStatus, 'All fields are required.', 'error');
    }
    setHint(commentStatus, 'Submitting…', 'info');
    submitCommentBtn.disabled = true;
    try {
      const res = await fetch(`${apiBase}/api/v1/public/videos/${encodeURIComponent(String(state.activeVideoId))}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'submit_failed');

      setHint(commentStatus, 'Thanks! Your comment has been added.', 'success');
      [cFirstName, cLastName, cCity, cEmail, cPhone, cComment].forEach((el) => {
        try {
          if (el) el.value = '';
        } catch {}
      });
      closeCommentModal();
      await refreshComments();
    } catch (e) {
      setHint(commentStatus, String(e?.message || e), 'error');
    } finally {
      submitCommentBtn.disabled = false;
    }
  }

  async function fetchAdminComments(videoId, kind) {
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    const res = await fetch(`${apiBase}/api/v1/videos/${encodeURIComponent(String(videoId))}/comments?kind=${encodeURIComponent(kind)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include'
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'failed_to_load_admin_comments');
    return Array.isArray(body?.comments) ? body.comments : [];
  }

  function renderAdminComments(list) {
    if (!adminCommentsList) return;
    adminCommentsList.innerHTML = '';
    if (adminCommentsEmpty) adminCommentsEmpty.style.display = 'none';

    if (!list.length) {
      if (adminCommentsEmpty) adminCommentsEmpty.style.display = '';
      return;
    }

    adminCommentsList.innerHTML = list
      .map((c) => {
        const id = escapeHtml(c.id);
        const who = escapeHtml(`${c.firstName || ''} ${c.lastName || ''}`.trim());
        const city = escapeHtml(c.city || '');
        const comment = escapeHtml(c.comment || '');
        const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '';
        const meta = c.kind === 'PUBLIC' ? `PUBLIC · ${createdAt}` : `SEEDED · ${createdAt}`;
        const contact = c.kind === 'PUBLIC' ? `Email: ${c.email || '—'} · Phone: ${c.phone || '—'}` : '';
        const pubLabel = c.published ? 'Hide' : 'Show';
        return `
          <div class="admin-row" data-comment-id="${id}">
            <div style="min-width:280px; flex:1;">
              <div style="font-weight:950;">${who || '—'} <span style="opacity:.55;">•</span> ${city || '—'}</div>
              <div style="margin-top:4px; color:#64748b; font-weight:750; font-size:12px;">${escapeHtml(meta)}</div>
              ${contact ? `<div style="margin-top:6px; color:#0f172a; font-weight:750; font-size:12px;">${escapeHtml(contact)}</div>` : ''}
              <pre style="margin-top:10px;">${comment}</pre>
            </div>
            <div class="actions">
              <button class="btn-secondary" data-action="toggle" data-published="${c.published ? '1' : '0'}">${pubLabel}</button>
              <button class="btn-secondary" data-action="delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `;
      })
      .join('');

    adminCommentsList.querySelectorAll('[data-comment-id]').forEach((row) => {
      const id = row.getAttribute('data-comment-id');
      row.querySelector('[data-action="toggle"]')?.addEventListener('click', async () => {
        try {
          const toggleBtn = row.querySelector('[data-action="toggle"]');
          const published = toggleBtn?.getAttribute('data-published') === '1';
          const token = (localStorage.getItem('feco.accessToken') || '').trim();
          const res = await fetch(`${apiBase}/api/v1/videos/comments/${encodeURIComponent(String(id))}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            credentials: 'include',
            body: JSON.stringify({ published: !published })
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || 'update_failed');
          await refreshAdminComments();
          await refreshComments();
        } catch (e) {
          setHint(adminCommentStatus, String(e?.message || e), 'error');
        }
      });
      row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        try {
          const token = (localStorage.getItem('feco.accessToken') || '').trim();
          const res = await fetch(`${apiBase}/api/v1/videos/comments/${encodeURIComponent(String(id))}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: 'include'
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body?.error || 'delete_failed');
          await refreshAdminComments();
          await refreshComments();
        } catch (e) {
          setHint(adminCommentStatus, String(e?.message || e), 'error');
        }
      });
    });
  }

  async function refreshAdminComments() {
    if (!state.me || state.me.role !== 'SUPER_ADMIN') return;
    if (!state.activeVideoId) return;
    const list = await fetchAdminComments(state.activeVideoId, state.adminTab);
    renderAdminComments(list);
  }

  async function addSeededComment() {
    if (!state.activeVideoId) return;
    const firstName = (aFirstName?.value || '').trim();
    const lastName = (aLastName?.value || '').trim();
    const city = (aCity?.value || '').trim();
    const comment = (aComment?.value || '').trim();
    const date = (aDate?.value || '').trim();
    if (!firstName || !lastName || !city || !comment) return setHint(adminCommentStatus, 'First/last/city/comment required.', 'error');

    setHint(adminCommentStatus, 'Adding…', 'info');
    addSeededBtn.disabled = true;
    try {
      const token = (localStorage.getItem('feco.accessToken') || '').trim();
      const res = await fetch(`${apiBase}/api/v1/videos/${encodeURIComponent(String(state.activeVideoId))}/comments/seeded`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ firstName, lastName, city, comment, date: date ? new Date(date).toISOString() : '' })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'create_failed');
      setHint(adminCommentStatus, 'Seeded comment added.', 'success');
      [aFirstName, aLastName, aCity, aDate, aComment].forEach((el) => {
        try {
          if (el) el.value = '';
        } catch {}
      });
      await refreshAdminComments();
      await refreshComments();
    } catch (e) {
      setHint(adminCommentStatus, String(e?.message || e), 'error');
    } finally {
      addSeededBtn.disabled = false;
    }
  }

  async function uploadVideo() {
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    const file = fileEl?.files?.[0];
    if (!file) return setHint(uploadStatus, 'Choose a video file first.', 'error');
    const title = (titleEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!title) return setHint(uploadStatus, 'Title is required.', 'error');

    setHint(uploadStatus, 'Uploading…', 'info');
    uploadBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('description', description);
      fd.append('file', file);
      const doUpload = async (bearer) => {
        const r = await fetch(`${apiBase}/api/v1/videos`, {
          method: 'POST',
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          credentials: 'include',
          body: fd
        });
        const body = await r.json().catch(() => ({}));
        return { r, body };
      };

      let { r: res, body } = await doUpload(token);
      if (res.status === 401) {
        try {
          const rr = await fetch(`${apiBase}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' });
          const rb = await rr.json().catch(() => ({}));
          const next = (rb?.accessToken || '').toString().trim();
          if (next) localStorage.setItem('feco.accessToken', next);
          ({ r: res, body } = await doUpload(next));
        } catch {}
      }

      if (!res.ok) {
        if (res.status === 401) {
          ensureLogin();
          throw new Error('unauthorized');
        }
        throw new Error(body?.error || 'upload_failed');
      }
      setHint(uploadStatus, 'Uploaded.', 'success');
      if (fileEl) fileEl.value = '';
      await bootstrapVideosOnly();
    } catch (e) {
      setHint(uploadStatus, String(e?.message || e), 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  }

  async function uploadThumbnail() {
    const file = thumbFileEl?.files?.[0];
    const title = (thumbTitleEl?.value || '').trim();
    if (!file) return setHint(thumbUploadStatus, 'Choose an image file first.', 'error');
    if (!title) return setHint(thumbUploadStatus, 'Title is required.', 'error');

    setHint(thumbUploadStatus, 'Uploading…', 'info');
    thumbUploadBtn.disabled = true;
    try {
      const token = (localStorage.getItem('feco.accessToken') || '').trim();
      const fd = new FormData();
      fd.append('title', title);
      fd.append('file', file);

      const doUpload = async (bearer) => {
        const r = await fetch(`${apiBase}/api/v1/thumbnails`, {
          method: 'POST',
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          credentials: 'include',
          body: fd
        });
        const body = await r.json().catch(() => ({}));
        return { r, body };
      };

      let { r: res, body } = await doUpload(token);
      if (res.status === 401) {
        try {
          const rr = await fetch(`${apiBase}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' });
          const rb = await rr.json().catch(() => ({}));
          const next = (rb?.accessToken || '').toString().trim();
          if (next) localStorage.setItem('feco.accessToken', next);
          ({ r: res, body } = await doUpload(next));
        } catch {}
      }

      if (!res.ok) {
        if (res.status === 401) {
          ensureLogin();
          throw new Error('unauthorized');
        }
        throw new Error(body?.error || 'upload_failed');
      }

      setHint(thumbUploadStatus, 'Uploaded.', 'success');
      if (thumbTitleEl) thumbTitleEl.value = '';
      if (thumbFileEl) thumbFileEl.value = '';
      await renderThumbnails();
    } catch (e) {
      setHint(thumbUploadStatus, String(e?.message || e), 'error');
    } finally {
      thumbUploadBtn.disabled = false;
    }
  }

  async function bootstrapVideosOnly() {
    const videos = await fetchVideos();
    await renderVideos(videos);
    await refreshComments();
    await refreshAdminComments();
    await renderThumbnails();
  }

  async function bootstrap() {
    state.me = await refreshMe();
    const role = (state.me?.role || '').toString();
    const canUpload = role === 'SUPER_ADMIN';

    if (uploadCard) uploadCard.style.display = canUpload ? '' : 'none';
    const setDisabled = (disabled) => {
      [titleEl, descEl, fileEl, uploadBtn].forEach((el) => {
        try {
          if (!el) return;
          el.disabled = !!disabled;
        } catch {}
      });
    };

    if (!state.me) {
      setDisabled(true);
      setHint(uploadStatus, 'Admin upload: login required.', 'info');
      if (loginBtn) loginBtn.textContent = 'Admin login';
      if (adminComments) adminComments.style.display = 'none';
      if (adminThumbnails) adminThumbnails.style.display = '';
      setHint(thumbUploadStatus, 'Admin thumbnails: login required.', 'info');
      if (thumbJumpBtn) thumbJumpBtn.style.display = 'none';
    } else if (!canUpload) {
      setDisabled(true);
      setHint(uploadStatus, `Admin upload: not allowed for role "${role || 'unknown'}".`, 'error');
      if (loginBtn) loginBtn.textContent = `Logged in (${role || 'user'})`;
      if (adminComments) adminComments.style.display = 'none';
      if (adminThumbnails) adminThumbnails.style.display = '';
      setHint(thumbUploadStatus, `Admin thumbnails: not allowed for role "${role || 'unknown'}".`, 'error');
      if (thumbJumpBtn) thumbJumpBtn.style.display = 'none';
    } else {
      setDisabled(false);
      setHint(uploadStatus, '', 'info');
      if (loginBtn) loginBtn.textContent = 'Logged in (admin)';
      if (adminComments) adminComments.style.display = '';
      if (adminThumbnails) adminThumbnails.style.display = '';
      setHint(thumbUploadStatus, '', 'info');
      if (thumbJumpBtn) thumbJumpBtn.style.display = '';
    }

    await bootstrapVideosOnly();
  }

  tabSeeded?.addEventListener('click', async () => {
    state.adminTab = 'SEEDED';
    tabSeeded.classList.add('active');
    tabPublic.classList.remove('active');
    await refreshAdminComments();
  });
  tabPublic?.addEventListener('click', async () => {
    state.adminTab = 'PUBLIC';
    tabPublic.classList.add('active');
    tabSeeded.classList.remove('active');
    await refreshAdminComments();
  });

  refreshBtn?.addEventListener('click', () => bootstrap());
  loginBtn?.addEventListener('click', () => ensureLogin());
  uploadBtn?.addEventListener('click', () => uploadVideo());
  thumbUploadBtn?.addEventListener('click', () => uploadThumbnail());
  thumbRefreshBtn?.addEventListener('click', () => renderThumbnails());
  refreshCommentsBtn?.addEventListener('click', () => refreshComments());
  openCommentModalBtn?.addEventListener('click', () => openCommentModal());
  commentModalClose?.addEventListener('click', () => closeCommentModal());
  commentModal?.addEventListener('click', (e) => {
    if (e.target === commentModal) closeCommentModal();
  });
  submitCommentBtn?.addEventListener('click', () => submitComment());
  addSeededBtn?.addEventListener('click', () => addSeededComment());

  bootstrap();
})();
