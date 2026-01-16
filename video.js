(() => {
  const apiBase = (window.FECO?.API_BASE || 'http://localhost:3001').toString().replace(/\/+$/, '');

  const grid = document.getElementById('videoGrid');
  const empty = document.getElementById('emptyState');
  const refreshBtn = document.getElementById('refreshBtn');
  const loginBtn = document.getElementById('loginBtn');
  const uploadCard = document.getElementById('uploadCard');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadStatus = document.getElementById('uploadStatus');
  const titleEl = document.getElementById('videoTitle');
  const descEl = document.getElementById('videoDescription');
  const fileEl = document.getElementById('videoFile');

  const modal = document.getElementById('playerModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const player = document.getElementById('player');
  const playerTitle = document.getElementById('playerTitle');
  const playerDesc = document.getElementById('playerDesc');

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

  function escapeHtml(value) {
    return (value || '').toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function setUploadStatus(text, kind) {
    if (!uploadStatus) return;
    uploadStatus.textContent = text || '';
    uploadStatus.style.color =
      kind === 'error' ? '#b91c1c' :
      kind === 'success' ? '#0b6b55' :
      '#64748b';
  }

  function openPlayer(video) {
    if (!modal || !player) return;
    player.pause();
    player.removeAttribute('src');
    player.load();
    if (playerTitle) playerTitle.textContent = video?.title || video?.originalName || 'Video';
    if (playerDesc) playerDesc.textContent = video?.description || '';
    player.src = `${apiBase}/api/v1/public/videos/${encodeURIComponent(video.id)}/file`;
    modal.style.display = 'flex';
    setTimeout(() => {
      try { player.play(); } catch {}
    }, 120);
  }

  function closePlayer() {
    if (!modal || !player) return;
    try { player.pause(); } catch {}
    modal.style.display = 'none';
    player.removeAttribute('src');
    player.load();
  }

  async function refreshMe() {
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    try {
      // Prefer Bearer token (localStorage) but fall back to cookie-based auth
      // (Safari/iOS can be flaky with localStorage in some contexts).
      const doMe = async (bearer) => {
        return fetch(`${apiBase}/api/v1/auth/me`, {
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          credentials: 'include'
        });
      };

      const refreshAccessToken = async () => {
        try {
          const r = await fetch(`${apiBase}/api/v1/auth/refresh`, {
            method: 'POST',
            credentials: 'include'
          });
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
        // Token can expire quickly; try cookie refresh once and retry /me.
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

  async function fetchVideos() {
    const res = await fetch(`${apiBase}/api/v1/public/videos`, { credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'failed_to_load');
    return Array.isArray(body?.videos) ? body.videos : [];
  }

  async function render() {
    if (!grid) return;
    grid.innerHTML = '';
    if (empty) empty.style.display = 'none';

    const videos = await fetchVideos();
    if (!videos.length) {
      if (empty) empty.style.display = '';
      return;
    }

    grid.innerHTML = videos.map((v) => {
      const t = escapeHtml(v.title || v.originalName || 'Video');
      const d = escapeHtml(v.description || '');
      const size = bytesLabel(v.sizeBytes);
      const date = v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '';
      return `
        <div class="video-card" data-video-id="${escapeHtml(v.id)}">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            <div class="pill"><i class="fa-solid fa-play"></i> Play</div>
            <div style="flex:1;">
              <h3>${t}</h3>
              ${d ? `<p>${d}</p>` : `<p style="opacity:.7;">No description</p>`}
              <div class="video-meta">
                <span><i class="fa-regular fa-clock"></i> ${escapeHtml(date || '—')}</span>
                <span style="opacity:.55;">•</span>
                <span><i class="fa-regular fa-file"></i> ${escapeHtml(size)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-video-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-video-id');
        const v = videos.find((x) => x.id === id);
        if (v) openPlayer(v);
      });
    });
  }

  async function uploadVideo() {
    const token = (localStorage.getItem('feco.accessToken') || '').trim();
    const file = fileEl?.files?.[0];
    if (!file) return setUploadStatus('Choose a video file first.', 'error');
    const title = (titleEl?.value || '').trim();
    const description = (descEl?.value || '').trim();
    if (!title) return setUploadStatus('Title is required.', 'error');

    setUploadStatus('Uploading...', 'info');
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
        // Try cookie refresh once, then retry.
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
      setUploadStatus('Uploaded.', 'success');
      if (fileEl) fileEl.value = '';
      await render();
    } catch (e) {
      setUploadStatus(String(e?.message || e), 'error');
    } finally {
      uploadBtn.disabled = false;
    }
  }

  async function bootstrap() {
    try {
      const me = await refreshMe();
      const canUpload = me?.role === 'SUPER_ADMIN';
      if (uploadCard) uploadCard.style.display = canUpload ? '' : 'none';
      if (loginBtn) loginBtn.textContent = me ? 'Logged in' : 'Admin login';
    } catch {}
    await render();
  }

  refreshBtn?.addEventListener('click', () => bootstrap());
  loginBtn?.addEventListener('click', () => ensureLogin());
  uploadBtn?.addEventListener('click', () => uploadVideo());
  closeModalBtn?.addEventListener('click', () => closePlayer());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closePlayer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlayer();
  });

  bootstrap();
})();
