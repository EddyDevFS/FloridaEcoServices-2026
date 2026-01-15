// Frontend runtime config (progressive migration flags)
// Overrides:
// - Query params: ?api=https://...&mode=API_ONLY
// - localStorage: feco.apiBase, feco.mode
//
// Production default (recommended):
// - API_BASE: same origin (reverse proxy routes /api/v1/* to backend)
// - MODE: API_ONLY
//
// Local dev default:
// - API_BASE: http://localhost:3001
// - MODE: DOUBLE_WRITE
(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const storedApi = localStorage.getItem('feco.apiBase') || '';
    const storedMode = localStorage.getItem('feco.mode') || '';

    const host = String(window.location.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');

    const defaultApiBase = isLocal ? 'http://localhost:3001' : window.location.origin;
    const defaultMode = isLocal ? 'DOUBLE_WRITE' : 'API_ONLY';

    const apiBase = String(params.get('api') || storedApi || defaultApiBase).trim().replace(/\/+$/, '');
    let mode = String(params.get('mode') || storedMode || defaultMode).trim();
    // Migration convenience: older sessions may be stuck in read-only mode.
    // If the user didn't explicitly request a mode via URL, upgrade to DOUBLE_WRITE.
    if (!params.get('mode') && (mode === 'API_READ_FALLBACK_LOCAL' || mode === 'API_READ_FALLBACK')) {
      mode = 'DOUBLE_WRITE';
      localStorage.setItem('feco.mode', mode);
    }

    // Persist if provided via URL (helps sharing a link)
    if (params.get('api')) localStorage.setItem('feco.apiBase', apiBase);
    if (params.get('mode')) localStorage.setItem('feco.mode', mode);

    window.FECO = {
      API_BASE: apiBase,
      MODE: mode
    };
  } catch {
    window.FECO = window.FECO || { API_BASE: 'http://localhost:3001', MODE: 'DOUBLE_WRITE' };
  }
})();
