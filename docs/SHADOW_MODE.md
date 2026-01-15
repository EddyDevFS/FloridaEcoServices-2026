# Shadow mode (API read + local fallback)

Goal: use the backend as the canonical source **without breaking the current synchronous frontend**.

How it works:
- The frontend stays “localStorage-first” (same code paths).
- On page load (if enabled), it pulls a full `hmp.v1`-shaped dataset from the backend into `localStorage`.
- In `DOUBLE_WRITE`, every local save also pushes the full dataset back to the backend import endpoint (best-effort).

## Enable (local)

Open any page with query params:
- `?api=http://localhost:3001&mode=API_READ_FALLBACK_LOCAL`

Example:
- `admin_config.html?api=http://localhost:3001&mode=API_READ_FALLBACK_LOCAL`

It persists these settings into localStorage:
- `feco.apiBase`
- `feco.mode`

## Login prompt

On first load in API modes, the frontend prompts for:
- email
- password

It stores:
- `feco.accessToken` (for API calls)
- backend also sets `access_token` + `refresh_token` cookies (for browser access to protected routes, including images).

## Modes

- `LOCAL_ONLY`: current behavior (no API calls)
- `API_READ_FALLBACK_LOCAL`: pull from API at startup, fallback to local if API down
- `DOUBLE_WRITE`: same as above + best-effort push to API on each local save

## Backend endpoints used

- `GET /api/v1/migration/localstorage/export` (auth)
- `POST /api/v1/migration/localstorage/import` (auth, SUPER_ADMIN)

