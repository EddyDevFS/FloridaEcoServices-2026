# Hotel Maintenance Pro (prototype)

This repo contains a 100% frontend prototype (HTML/CSS/JS) with 3 “surfaces”:

- `index.html`: landing / marketing site.
- `app.html` → `index_old.html`: admin hotel setup app (local multi-hotel storage).
- `MAINTENANCE_PRO/index.html`: provider cockpit (dashboard + contracts) based on `MAINTENANCE_PRO/CORE/database.js`.

## Run locally

Start a static server from the repo root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/index.html`
- `http://localhost:8000/app.html`
- `http://localhost:8000/MAINTENANCE_PRO/index.html`

## Backend (migration)

We are adding a backend API in `backend/` (PostgreSQL + API).

- Plan: `docs/MIGRATION_PLAN.md`
- Hosting notes: `docs/APP_HOSTING.md`
- Progressive migration modes: `docs/MIGRATION_SWITCHES.md`

Local (requires Docker running):

```bash
docker compose up --build
curl http://localhost:3001/health
```

API one-shot smoke test (runs login/refresh + creates a test hotel/structure):

```bash
FECO_EMAIL="eddy@floridaecoservices.com" FECO_PASSWORD="your-password" \
python3 scripts/api_smoke_test.py
```

CRM API smoke test (creates campaign + lead and schedules first email):

```bash
FECO_EMAIL="eddy@floridaecoservices.com" FECO_PASSWORD="your-password" \
python3 scripts/crm_smoke_test.py
```

## CRM leads + email campaigns (backend)

The backend now exposes a CRM layer (leads + multi-step email campaigns) that reuses the existing SMTP sender (`backend/src/email/mailer.ts`) and can link a lead to a quote to avoid retyping customer info.

- API:
  - `GET/POST /api/v1/crm/leads`
  - `GET/POST /api/v1/crm/campaigns` (publish via `POST /api/v1/crm/campaigns/:id/publish`)
  - `POST /api/v1/crm/leads/:leadId/start-campaign`
  - `POST /api/v1/crm/lead-campaigns/:leadCampaignId/validation` (`NO_REPLY` / `REPLIED`)
- Tracking:
  - `GET /t/pixel?mid=...` (open)
  - `GET /t/click?mid=...&url=...` (click)
- Quote integration:
  - `POST /api/v1/quotes` accepts optional `leadId` and auto-fills customer fields.
  - `PATCH /api/v1/quotes/:id` accepts `leadId` to (re)link a quote to a lead.

## Storage (current state)

- Admin hotel setup: `localStorage` key `hmp.config.v1` (multiple hotels, selected via dropdown).
- Provider maintenance/contracts: `localStorage` key `hotel-maintenance-pro` (demo), via `window.HotelDB`.

These storages are not unified yet; that’s the next recommended foundation (see `docs/ROADMAP.md`).

## Migration plan (backend)

Track the backend/API/DB migration work in `docs/MIGRATION_PLAN.md`.
