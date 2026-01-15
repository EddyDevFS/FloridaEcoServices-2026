# Progressive migration switches (frontend → API)

Goal: move from `localStorage` (source of truth today) to API+DB (source of truth tomorrow) **without breaking the app**.

## Principle

We migrate in 4 modes, controlled by feature flags:

1) `LOCAL_ONLY` (today)
- Read/write only localStorage (`shared/db.js`)

2) `API_READ_FALLBACK_LOCAL`
- Read from API when possible, fallback to localStorage if API is down
- Write still local-only

3) `DOUBLE_WRITE`
- Read from API (fallback local)
- Write to API **and** localStorage (logs errors but doesn’t block UI)

4) `API_ONLY`
- Read/write only API
- localStorage used only for cache/offline (optional) and export safety

## Suggested flags (simple)

In a future `frontend/app-config.js` (or inline config), we can define:
- `window.FECO = { API_BASE: "https://api.app.floridaecoservices.com", MODE: "DOUBLE_WRITE" }`

Modes:
- `"LOCAL_ONLY"`
- `"API_READ_FALLBACK_LOCAL"`
- `"DOUBLE_WRITE"`
- `"API_ONLY"`

## Current implementation (V1)

Implemented:
- `API_READ_FALLBACK_LOCAL`: via `GET /api/v1/migration/localstorage/export` pulled into `localStorage`
- `DOUBLE_WRITE`: best-effort dataset push via `POST /api/v1/migration/localstorage/import`
  - Default mode in `app-config.js` is now `DOUBLE_WRITE` (normal behavior: local save + background sync after login).
  - Safety: `apiPullLocalStorage()` will not overwrite newer local data; in `DOUBLE_WRITE` it also attempts a best-effort push if local is newer.

Not implemented yet:
- true per-entity read/write (async refactor)
- `"API_ONLY"` frontend mode

## Required behaviors (DoD)

- If API is down in `API_READ_FALLBACK_LOCAL` or `DOUBLE_WRITE`:
  - UI stays usable
  - errors are logged
  - localStorage remains consistent
- In `DOUBLE_WRITE`:
  - API errors must not block the user flow
  - we keep a queue of failed writes (optional V1)
- In `API_ONLY`:
  - all flows must be covered by endpoints
  - smoke test must pass + manual checklist must pass

## Migration order (recommended)

1) Auth + hotels list/select
2) Structure (buildings/floors/rooms/spaces)
3) Planning/tasks + incidents + history
4) Attachments/photos
5) Contracts/sessions/pricing
