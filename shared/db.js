// Hotel Maintenance Pro - Local DB (no backend)
// Single source of truth for admin + hotel interfaces.

(() => {
  const STORAGE_KEY = 'hmp.v1';
  const LEGACY_KEY = 'hmp.config.v1';
  const FECO_ACCESS_TOKEN_KEY = 'feco.accessToken';
  const FECO_LAST_SYNC_KEY = 'feco.lastSyncAt';

  function getFecoConfig() {
    const cfg = window.FECO || {};
    const apiBase = (cfg.API_BASE || localStorage.getItem('feco.apiBase') || 'http://localhost:3001')
      .toString()
      .trim()
      .replace(/\/+$/, '');
    const mode = (cfg.MODE || localStorage.getItem('feco.mode') || 'LOCAL_ONLY').toString().trim();
    // API_ONLY in V1 means "API required + sync forced", while still using the
    // dataset export/import mechanism (no endpoint-by-endpoint refactor yet).
    return { apiBase, mode };
  }

  function emitSync(detail) {
    try {
      window.dispatchEvent(new CustomEvent('feco:sync', { detail }));
    } catch {}
  }

  function getAccessToken() {
    return (localStorage.getItem(FECO_ACCESS_TOKEN_KEY) || '').trim();
  }

  function getLastSyncAtMs() {
    const raw = (localStorage.getItem(FECO_LAST_SYNC_KEY) || '').trim();
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  }

  function setAccessToken(token) {
    const t = (token || '').toString().trim();
    if (!t) localStorage.removeItem(FECO_ACCESS_TOKEN_KEY);
    else localStorage.setItem(FECO_ACCESS_TOKEN_KEY, t);
    return t;
  }

  const defaultData = () => ({
    version: 1,
    activeHotelId: null,
    hotels: {},
    contracts: {},
    sessions: {},
    reservations: {},
    incidents: {},
    tasks: {},
    staff: {},
    technicians: {},
    availability: {
      blocked: []
    },
    settings: {
      timezone: 'America/New_York',
      workHours: {
        start: '08:00',
        end: '17:00'
      }
    },
    pricing: {
      defaults: {
        roomsMinPerSession: 10,
        roomsMaxPerSession: 20,
        basePrices: {
          BOTH: 65,
          CARPET: 45,
          TILE: 40
        },
        penaltyPrices: {
          BOTH: 75,
          CARPET: 55,
          TILE: 50
        },
        contractPrices: {
          BOTH: 65,
          CARPET: 45,
          TILE: 40
        },
        advantagePrices: {
          BOTH: 60,
          CARPET: 42,
          TILE: 38
        },
        sqftPrices: {
          CARPET: 0,
          TILE: 0
        }
      }
    },
    updatedAt: new Date().toISOString()
  });

  let data = null;
  let apiPushTimer = null;

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function scheduleApiPush() {
    const { mode } = getFecoConfig();
    if (mode !== 'DOUBLE_WRITE' && mode !== 'API_ONLY') return;
    if (!getAccessToken()) return;
    clearTimeout(apiPushTimer);
    apiPushTimer = setTimeout(() => {
      if (window.HMP_DB?.apiPushLocalStorage) {
        window.HMP_DB.apiPushLocalStorage().catch(() => {});
      }
    }, 150);
  }

  function save() {
    if (!data) return;
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    scheduleApiPush();
  }

  function normalizeData(current) {
    const base = defaultData();
    const next = current || base;

    if (!next.hotels) next.hotels = {};
    if (!next.contracts) next.contracts = {};
    if (!next.sessions) next.sessions = {};
    if (!next.reservations) next.reservations = {};
    if (!next.incidents) next.incidents = {};
    if (!next.tasks) next.tasks = {};
    if (!next.staff) next.staff = {};
    if (!next.technicians) next.technicians = {};
    if (!next.availability) next.availability = { blocked: [] };
    if (!next.availability.blocked) next.availability.blocked = [];
    if (!next.settings) next.settings = base.settings;

    if (!next.pricing) next.pricing = base.pricing;
    if (!next.pricing.defaults) next.pricing.defaults = base.pricing.defaults;

    const defaults = base.pricing.defaults;
    const pricing = next.pricing.defaults;
    if (pricing.roomsMinPerSession == null) pricing.roomsMinPerSession = defaults.roomsMinPerSession;
    if (pricing.roomsMaxPerSession == null) pricing.roomsMaxPerSession = defaults.roomsMaxPerSession;
    if (!pricing.basePrices) pricing.basePrices = defaults.basePrices;
    if (!pricing.penaltyPrices) pricing.penaltyPrices = defaults.penaltyPrices;
    if (!pricing.contractPrices) pricing.contractPrices = defaults.contractPrices;
    if (!pricing.advantagePrices) pricing.advantagePrices = defaults.advantagePrices;
    if (!pricing.sqftPrices) pricing.sqftPrices = defaults.sqftPrices;

    return next;
  }

  function migrateLegacy(legacy) {
    const migrated = defaultData();
    if (!legacy || !legacy.hotels) return migrated;

    migrated.hotels = legacy.hotels || {};
    migrated.activeHotelId = legacy.activeHotelId || Object.keys(migrated.hotels)[0] || null;
    return normalizeData(migrated);
  }

  function load() {
    const parsed = safeParse(localStorage.getItem(STORAGE_KEY));
    if (parsed && parsed.version) return normalizeData(parsed);

    const legacy = safeParse(localStorage.getItem(LEGACY_KEY));
    if (legacy) {
      const migrated = migrateLegacy(legacy);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    const fresh = normalizeData(defaultData());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function ensureLoaded() {
    if (!data) data = load();
    data = normalizeData(data);

    const hasLegacyIncidents = Object.keys(data.incidents || {}).length > 0;
    const hasTasks = Object.keys(data.tasks || {}).length > 0;
    if (hasLegacyIncidents && !hasTasks) {
      data.tasks = data.incidents;
      data.incidents = {};
      save();
    }
  }

  function generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const DB = {
    init() {
      ensureLoaded();
      return data;
    },

    getData() {
      ensureLoaded();
      return data;
    },

    getMigrationMode() {
      return getFecoConfig().mode;
    },

    getApiBase() {
      return getFecoConfig().apiBase;
    },

    getAccessToken() {
      return getAccessToken();
    },

    setAccessToken(token) {
      return setAccessToken(token);
    },

    async apiLogin(email, password) {
      const { apiBase } = getFecoConfig();
      const res = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: (email || '').toString().trim().toLowerCase(), password: (password || '').toString() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = body?.error || 'login_failed';
        emitSync({ kind: 'auth', ok: false, error: err });
        throw new Error(err);
      }
      if (body?.accessToken) setAccessToken(body.accessToken);
      emitSync({ kind: 'auth', ok: true });
      return body;
    },

    async apiLogout() {
      const { apiBase } = getFecoConfig();
      try {
        await fetch(`${apiBase}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
      } finally {
        setAccessToken('');
      }
      return true;
    },

    async apiPatchTaskByLegacy(taskId, patch) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/tasks/by-legacy/${encodeURIComponent(String(taskId))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'patch_failed' };
      return { ok: true, task: body?.task || null };
    },

    async apiCreateTaskEventByLegacy(taskId, payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/tasks/by-legacy/${encodeURIComponent(String(taskId))}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'event_failed' };
      return { ok: true, event: body?.event || null };
    },

    async apiPatchReservation(reservationId, patch) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/reservations/${encodeURIComponent(String(reservationId))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'patch_failed' };
      return { ok: true, reservation: body?.reservation || null };
    },

    async apiCancelReservation(reservationId, payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/reservations/${encodeURIComponent(String(reservationId))}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'cancel_failed' };
      return { ok: true, reservation: body?.reservation || null };
    },

    async apiDeleteReservation(reservationId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/reservations/${encodeURIComponent(String(reservationId))}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'delete_failed' };
      return { ok: true };
    },

    async apiPatchReservationByToken(reservationToken, patch) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };

      const res = await fetch(`${apiBase}/api/v1/reservations/by-token/${encodeURIComponent(String(reservationToken))}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'patch_failed' };
      return { ok: true, reservation: body?.reservation || null };
    },

    async apiCancelReservationByToken(reservationToken, payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };

      const res = await fetch(`${apiBase}/api/v1/reservations/by-token/${encodeURIComponent(String(reservationToken))}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'cancel_failed' };
      return { ok: true, reservation: body?.reservation || null };
    },

    async apiUpsertTechnician(payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/technicians`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'upsert_failed' };
      return { ok: true, technician: body?.technician || null };
    },

    async apiDeleteTechnician(technicianId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/technicians/${encodeURIComponent(String(technicianId))}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'delete_failed' };
      return { ok: true };
    },

    async apiUpsertBlockedSlot(payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/blocked-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'upsert_failed' };
      return { ok: true, blockedSlot: body?.blockedSlot || null };
    },

    async apiDeleteBlockedSlot(slotId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };

      const res = await fetch(`${apiBase}/api/v1/blocked-slots/${encodeURIComponent(String(slotId))}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'delete_failed' };
      return { ok: true };
    },

    async apiUpsertSession(hotelId, payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const res = await fetch(`${apiBase}/api/v1/hotels/${encodeURIComponent(String(hotelId))}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'upsert_failed' };
      return { ok: true, session: body?.session || null };
    },

    async apiDeleteSession(hotelId, sessionId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const res = await fetch(`${apiBase}/api/v1/hotels/${encodeURIComponent(String(hotelId))}/sessions/${encodeURIComponent(String(sessionId))}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'delete_failed' };
      return { ok: true };
    },

    async apiGetAnnualReport(hotelId, year) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const y = Number(year);
      const res = await fetch(`${apiBase}/api/v1/reports/annual?hotelId=${encodeURIComponent(String(hotelId))}&year=${encodeURIComponent(String(y))}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'report_failed' };
      return { ok: true, report: body };
    },

    async apiGetRoadmap(hotelId, date) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const res = await fetch(`${apiBase}/api/v1/reports/roadmap?hotelId=${encodeURIComponent(String(hotelId))}&date=${encodeURIComponent(String(date || ''))}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'report_failed' };
      return { ok: true, roadmap: body };
    },

    // ===== CONTRACTS (DB-backed) =====
    async apiListContractsByHotel(hotelId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const res = await fetch(`${apiBase}/api/v1/hotels/${encodeURIComponent(String(hotelId))}/contracts`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'list_failed' };
      return { ok: true, contracts: body?.contracts || [] };
    },

    async apiCreateContract(hotelId, payload) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!hotelId) return { ok: false, status: 400, error: 'missing_hotel_id' };

      const res = await fetch(`${apiBase}/api/v1/hotels/${encodeURIComponent(String(hotelId))}/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'create_failed' };
      return { ok: true, contract: body?.contract || null };
    },

    async apiGetContractByToken(token) {
      const { apiBase } = getFecoConfig();
      if (!apiBase) return { ok: false, skipped: true };
      if (!token) return { ok: false, status: 400, error: 'missing_token' };

      const res = await fetch(`${apiBase}/api/v1/contracts/by-token/${encodeURIComponent(String(token))}`, {
        method: 'GET',
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'get_failed' };
      return { ok: true, contract: body?.contract || null };
    },

    async apiAcceptContractByToken(token, signedBy) {
      const { apiBase } = getFecoConfig();
      if (!apiBase) return { ok: false, skipped: true };
      if (!token) return { ok: false, status: 400, error: 'missing_token' };
      const name = String(signedBy || '').trim();
      if (!name) return { ok: false, status: 400, error: 'missing_signed_by' };

      const res = await fetch(`${apiBase}/api/v1/contracts/by-token/${encodeURIComponent(String(token))}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ signedBy: name })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'accept_failed' };
      return { ok: true, contract: body?.contract || null };
    },

    async apiSendContract(contractId) {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };
      const token = getAccessToken();
      if (!token) return { ok: false, status: 401 };
      if (!contractId) return { ok: false, status: 400, error: 'missing_contract_id' };

      const res = await fetch(`${apiBase}/api/v1/contracts/${encodeURIComponent(String(contractId))}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, status: res.status, error: body?.error || 'send_failed' };
      return { ok: true, messageId: body?.messageId || null };
    },

    async apiPullLocalStorage() {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || mode === 'LOCAL_ONLY') return { ok: false, skipped: true };

      ensureLoaded();
      emitSync({ kind: 'pull', state: 'start' });

      // "Normal app" rule: never overwrite unsynced local changes on refresh.
      // We determine "unsynced" via updatedAt vs lastSyncAt (server export timestamps are not reliable).
      const localUpdatedAtMs = Date.parse(String(data?.updatedAt || ''));
      const lastSyncAtMs = getLastSyncAtMs();
      const localHasUnsyncedChanges =
        mode !== 'API_ONLY' &&
        Number.isFinite(localUpdatedAtMs) &&
        (lastSyncAtMs === null || localUpdatedAtMs > lastSyncAtMs);

      const token = getAccessToken();
      if (localHasUnsyncedChanges) {
        // If we can, push first (so API becomes up-to-date), then pull.
        // If we cannot auth, keep local and skip pull to prevent data loss.
        if (!token) {
          emitSync({ kind: 'pull', state: 'ok', keptLocal: true, reason: 'unsynced_local_no_auth' });
          return { ok: true, keptLocal: true };
        }
        try {
          const pushed = await DB.apiPushLocalStorage();
          if (!pushed?.ok) {
            emitSync({ kind: 'pull', state: 'ok', keptLocal: true, reason: 'unsynced_local_push_failed' });
            return { ok: true, keptLocal: true };
          }
        } catch {
          emitSync({ kind: 'pull', state: 'ok', keptLocal: true, reason: 'unsynced_local_push_exception' });
          return { ok: true, keptLocal: true };
        }
      }
      const res = await fetch(`${apiBase}/api/v1/migration/localstorage/export`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include'
      });

      if (res.status === 401) {
        emitSync({ kind: 'pull', state: 'fail', status: 401, error: 'unauthorized' });
        return { ok: false, status: 401 };
      }
      if (!res.ok) {
        emitSync({ kind: 'pull', state: 'fail', status: res.status });
        return { ok: false, status: res.status };
      }

      const body = await res.json().catch(() => ({}));
      const fetched = normalizeData(body?.data);

      // Safety: never overwrite a newer local dataset with an older API dataset,
      // except in API_ONLY where API is the source of truth.
      const localTs = Date.parse(String(data?.updatedAt || ''));
      const apiTs = Date.parse(String(fetched?.updatedAt || ''));
      if (mode !== 'API_ONLY' && Number.isFinite(localTs) && Number.isFinite(apiTs) && localTs > apiTs) {
        emitSync({ kind: 'pull', state: 'ok', keptLocal: true });
        // In DOUBLE_WRITE, if local is newer we try to push it back (best effort).
        if (mode === 'DOUBLE_WRITE') {
          try {
            await DB.apiPushLocalStorage();
          } catch {}
        }
        return { ok: true, keptLocal: true };
      }

      data = fetched;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      try {
        localStorage.setItem(FECO_LAST_SYNC_KEY, new Date().toISOString());
      } catch {}
      emitSync({ kind: 'pull', state: 'ok', pulled: true });
      return { ok: true, pulled: true };
    },

    async apiPushLocalStorage() {
      const { apiBase, mode } = getFecoConfig();
      if (!apiBase || (mode !== 'DOUBLE_WRITE' && mode !== 'API_ONLY')) return { ok: false, skipped: true };
      ensureLoaded();
      const token = getAccessToken();
      if (!token) {
        emitSync({ kind: 'push', state: 'fail', status: 401, error: 'missing_token' });
        return { ok: false, status: 401 };
      }

      emitSync({ kind: 'push', state: 'start' });
      const res = await fetch(`${apiBase}/api/v1/migration/localstorage/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        emitSync({ kind: 'push', state: 'fail', status: res.status, error: body?.error || 'import_failed' });
        return { ok: false, status: res.status, error: body?.error || 'import_failed' };
      }

      try {
        localStorage.setItem(FECO_LAST_SYNC_KEY, new Date().toISOString());
      } catch {}
      emitSync({ kind: 'push', state: 'ok', summary: body?.summary || null });
      return { ok: true, summary: body?.summary };
    },

    getHotels() {
      ensureLoaded();
      return Object.values(data.hotels || {});
    },

    getHotel(hotelId) {
      ensureLoaded();
      return data.hotels?.[hotelId] || null;
    },

    getActiveHotelId() {
      ensureLoaded();
      return data.activeHotelId || null;
    },

    getActiveHotel() {
      ensureLoaded();
      const id = data.activeHotelId;
      return id ? data.hotels?.[id] || null : null;
    },

    setActiveHotelId(hotelId) {
      ensureLoaded();
      data.activeHotelId = hotelId;
      save();
    },

    saveHotel(hotel) {
      ensureLoaded();
      if (!hotel?.id) return;
      data.hotels[hotel.id] = hotel;
      save();
    },

    createHotel(name) {
      ensureLoaded();
      const id = generateId('hotel');
      const hotel = { id, name: name.trim(), buildings: [] };
      data.hotels[id] = hotel;
      data.activeHotelId = id;
      save();
      return hotel;
    },

    renameHotel(hotelId, name) {
      ensureLoaded();
      const hotel = data.hotels?.[hotelId];
      if (!hotel) return;
      hotel.name = name.trim();
      save();
      return hotel;
    },

    getPricingDefaults() {
      ensureLoaded();
      const fallback = defaultData().pricing.defaults;
      const current = data.pricing?.defaults || {};
      if (!current.basePrices) return { ...fallback, ...current };
      return current;
    },

    setPricingDefaults(next) {
      ensureLoaded();
      data.pricing.defaults = {
        ...data.pricing.defaults,
        ...next
      };
      save();
    },

    createContract(payload) {
      ensureLoaded();
      const explicitId = payload?.id ? String(payload.id) : '';
      const explicitToken = payload?.token ? String(payload.token) : '';
      const id = explicitId || generateId('contract');
      const token = explicitToken || generateId('token');
      const contract = {
        id,
        token,
        status: 'SENT',
        createdAt: new Date().toISOString(),
        ...payload
      };
      data.contracts[id] = contract;
      save();
      return contract;
    },

    updateContract(contractId, patch) {
      ensureLoaded();
      const contract = data.contracts?.[contractId];
      if (!contract) return null;
      Object.assign(contract, patch);
      save();
      return contract;
    },

    listContractsByHotel(hotelId) {
      ensureLoaded();
      return Object.values(data.contracts || {}).filter(c => c.hotelId === hotelId);
    },

    getContractByToken(token) {
      ensureLoaded();
      return Object.values(data.contracts || {}).find(c => c.token === token) || null;
    },

    listSessionsByHotel(hotelId) {
      ensureLoaded();
      return Object.values(data.sessions || {}).filter(s => s.hotelId === hotelId);
    },

    // ===== TASKS (hotel internal) =====
    listTasks() {
      ensureLoaded();
      return Object.values(data.tasks || {}).map(t => ({
        ...t,
        locations: Array.isArray(t.locations) ? t.locations : (t.location ? [t.location] : [{ label: t.room || '' }]),
        location: t.location || { label: t.room || '' },
        status: t.status || 'OPEN',
        priority: t.priority || 'NORMAL',
        schedule: t.schedule || null,
        events: Array.isArray(t.events) ? t.events : [],
        attachments: Array.isArray(t.attachments) ? t.attachments : []
      }));
    },

    listTasksByHotel(hotelId) {
      ensureLoaded();
      return Object.values(data.tasks || {})
        .filter(t => t.hotelId === hotelId)
        .map(t => ({
          ...t,
          locations: Array.isArray(t.locations) ? t.locations : (t.location ? [t.location] : [{ label: t.room || '' }]),
          location: t.location || { label: t.room || '' },
          status: t.status || 'OPEN',
          priority: t.priority || 'NORMAL',
          schedule: t.schedule || null,
          events: Array.isArray(t.events) ? t.events : [],
          attachments: Array.isArray(t.attachments) ? t.attachments : []
        }));
    },

    listTasksByStaff(staffId) {
      ensureLoaded();
      return Object.values(data.tasks || {})
        .filter(t => t.assignedStaffId === staffId)
        .map(t => ({
          ...t,
          locations: Array.isArray(t.locations) ? t.locations : (t.location ? [t.location] : [{ label: t.room || '' }]),
          location: t.location || { label: t.room || '' },
          status: t.status || 'OPEN',
          priority: t.priority || 'NORMAL',
          schedule: t.schedule || null,
          events: Array.isArray(t.events) ? t.events : [],
          attachments: Array.isArray(t.attachments) ? t.attachments : []
        }));
    },

    getTask(taskId) {
      ensureLoaded();
      const task = data.tasks?.[taskId];
      if (!task) return null;
      return {
        ...task,
        locations: Array.isArray(task.locations) ? task.locations : (task.location ? [task.location] : [{ label: task.room || '' }]),
        location: task.location || { label: task.room || '' },
        status: task.status || 'OPEN',
        priority: task.priority || 'NORMAL',
        schedule: task.schedule || null,
        events: Array.isArray(task.events) ? task.events : [],
        attachments: Array.isArray(task.attachments) ? task.attachments : []
      };
    },

    addTask(payload) {
      ensureLoaded();
      const id = generateId('task');
      const createdAt = new Date().toISOString();
      const locations = Array.isArray(payload.locations)
        ? payload.locations
        : (payload.location ? [payload.location] : [{ label: payload.room || '' }]);
      const locationPreview = locations
        .map(l => l?.label)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      const task = {
        id,
        hotelId: payload.hotelId,
        category: payload.category || 'TASK',
        status: payload.status || 'OPEN',
        type: payload.type || 'OTHER',
        priority: payload.priority || 'NORMAL',
        locations,
        location: payload.location || { label: locationPreview || payload.room || '' },
        description: payload.description || '',
        assignedStaffId: payload.assignedStaffId || null,
        schedule: payload.schedule || null,
        createdAt,
        updatedAt: createdAt,
        events: [],
        attachments: []
      };

      task.events.push({
        id: generateId('event'),
        at: createdAt,
        action: 'CREATED',
        actorRole: payload.actorRole || 'hotel_manager',
        actorStaffId: payload.actorStaffId || null,
        note: payload.description || ''
      });

      data.tasks[id] = task;
      save();
      return task;
    },

    updateTask(taskId, patch) {
      ensureLoaded();
      const task = data.tasks?.[taskId];
      if (!task) return null;
      Object.assign(task, patch, { updatedAt: new Date().toISOString() });
      save();
      return task;
    },

    addTaskEvent(taskId, payload) {
      ensureLoaded();
      const task = data.tasks?.[taskId];
      if (!task) return null;
      if (!Array.isArray(task.events)) task.events = [];
      const event = {
        id: generateId('event'),
        at: new Date().toISOString(),
        action: payload.action,
        actorRole: payload.actorRole || 'hotel_manager',
        actorStaffId: payload.actorStaffId || null,
        note: payload.note || '',
        patch: payload.patch || null
      };
      task.events.push(event);
      task.updatedAt = event.at;
      save();
      return event;
    },

    addTaskAttachment(taskId, payload) {
      ensureLoaded();
      const task = data.tasks?.[taskId];
      if (!task) return null;
      if (!Array.isArray(task.attachments)) task.attachments = [];
      const attachment = {
        id: payload.id || generateId('att'),
        at: payload.at || new Date().toISOString(),
        name: payload.name || 'photo',
        mime: payload.mime || 'image/*',
        dataUrl: payload.dataUrl,
        url: payload.url || null,
        storagePath: payload.storagePath || null,
        sizeBytes: payload.sizeBytes || null,
        width: payload.width || null,
        height: payload.height || null,
        actorRole: payload.actorRole || 'hotel_staff',
        actorStaffId: payload.actorStaffId || null
      };
      task.attachments.push(attachment);
      task.updatedAt = attachment.at;
      save();
      return attachment;
    },

    listReservationsByHotel(hotelId) {
      ensureLoaded();
      return Object.values(data.reservations || {}).filter(r => r.hotelId === hotelId);
    },

    // ===== COMPAT (legacy incidents API) =====
    listIncidentsByHotel(hotelId) {
      return DB.listTasksByHotel(hotelId);
    },

    addIncident(payload) {
      return DB.addTask({
        ...payload,
        category: payload.category || 'INCIDENT',
        location: payload.location || { label: payload.room || '' }
      });
    },

    addIncidentEvent(incidentId, payload) {
      return DB.addTaskEvent(incidentId, payload);
    },

    updateIncident(incidentId, patch) {
      return DB.updateTask(incidentId, patch);
    },

    listIncidentsByStaff(staffId) {
      return DB.listTasksByStaff(staffId);
    },

    listStaffByHotel(hotelId, opts = {}) {
      ensureLoaded();
      const includeInactive = !!opts.includeInactive;
      return Object.values(data.staff || {})
        .filter(member => member.hotelId === hotelId)
        .filter(member => includeInactive ? true : member.active !== false)
        .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || ''));
    },

    addStaff(payload) {
      ensureLoaded();
      const id = generateId('staff');
      const token = generateId('stafftok');
      const member = {
        id,
        token,
        hotelId: payload.hotelId,
        firstName: (payload.firstName || '').trim(),
        lastName: (payload.lastName || '').trim(),
        phone: payload.phone || '',
        notes: payload.notes || '',
        active: true,
        createdAt: new Date().toISOString()
      };
      data.staff[id] = member;
      save();
      return member;
    },

    updateStaff(staffId, patch) {
      ensureLoaded();
      const member = data.staff?.[staffId];
      if (!member) return null;
      Object.assign(member, patch);
      save();
      return member;
    },

    getStaff(staffId) {
      ensureLoaded();
      return data.staff?.[staffId] || null;
    },

    getStaffByToken(token) {
      ensureLoaded();
      return Object.values(data.staff || {}).find(s => s.token === token) || null;
    },

    listReservations() {
      ensureLoaded();
      return Object.values(data.reservations || {});
    },

    createReservation(payload) {
      ensureLoaded();
      const id = generateId('reservation');
      const token = generateId('resv');
      const reservation = {
        id,
        token,
        statusAdmin: 'PROPOSED',
        statusHotel: 'PENDING',
        createdAt: new Date().toISOString(),
        ...payload
      };
      data.reservations[id] = reservation;
      save();
      return reservation;
    },

    updateReservation(reservationId, patch) {
      ensureLoaded();
      const reservation = data.reservations?.[reservationId];
      if (!reservation) return null;
      Object.assign(reservation, patch);
      save();
      return reservation;
    },

    cancelReservation(reservationId, payload = {}) {
      ensureLoaded();
      const reservation = data.reservations?.[reservationId];
      if (!reservation) return null;
      const now = new Date().toISOString();
      reservation.statusAdmin = 'CANCELLED';
      reservation.statusHotel = 'CANCELLED';
      reservation.cancelledAt = now;
      reservation.cancelledBy = payload.by || 'admin';
      reservation.cancelReason = payload.reason || '';
      save();
      return reservation;
    },

    deleteReservation(reservationId) {
      ensureLoaded();
      if (!data.reservations?.[reservationId]) return false;
      delete data.reservations[reservationId];
      save();
      return true;
    },

    getReservationByToken(token) {
      ensureLoaded();
      return Object.values(data.reservations || {}).find(r => r.token === token) || null;
    },

    createSession(payload) {
      ensureLoaded();
      const id = generateId('session');
      const session = {
        id,
        status: 'SCHEDULED',
        createdAt: new Date().toISOString(),
        ...payload
      };
      data.sessions[id] = session;
      save();
      return session;
    },

    listTechnicians() {
      ensureLoaded();
      return Object.values(data.technicians || {});
    },

    addTechnician(payload) {
      ensureLoaded();
      const id = generateId('tech');
      const technician = {
        id,
        name: payload.name,
        phone: payload.phone || '',
        notes: payload.notes || '',
        active: true,
        createdAt: new Date().toISOString()
      };
      data.technicians[id] = technician;
      save();
      return technician;
    },

    updateTechnician(techId, patch) {
      ensureLoaded();
      const tech = data.technicians?.[techId];
      if (!tech) return null;
      Object.assign(tech, patch);
      save();
      return tech;
    },

    deleteTechnician(techId) {
      ensureLoaded();
      if (!data.technicians?.[techId]) return false;
      delete data.technicians[techId];
      save();
      return true;
    },

    listBlockedSlots() {
      ensureLoaded();
      return data.availability.blocked || [];
    },

    addBlockedSlot(payload) {
      ensureLoaded();
      const slot = {
        id: generateId('block'),
        ...payload,
        createdAt: new Date().toISOString()
      };
      data.availability.blocked.push(slot);
      save();
      return slot;
    },

    deleteBlockedSlot(slotId) {
      ensureLoaded();
      const before = data.availability.blocked.length;
      data.availability.blocked = data.availability.blocked.filter(b => b.id !== slotId);
      save();
      return before !== data.availability.blocked.length;
    },

    getSettings() {
      ensureLoaded();
      return data.settings || defaultData().settings;
    },

    updateSettings(patch) {
      ensureLoaded();
      data.settings = {
        ...data.settings,
        ...patch
      };
      save();
      return data.settings;
    }
  };

  window.HMP_DB = DB;
})();
