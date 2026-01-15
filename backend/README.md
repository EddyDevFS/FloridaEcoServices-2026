# Backend (API)

V1 goals:
- Email/password auth (secure + simple)
- Multi-hotel (single Florida Eco org)
- PostgreSQL persistence
- Attachments (photos) stored on server disk

## Local dev (Docker)

From repo root:

```bash
docker compose up --build
```

API healthcheck:

```bash
curl http://localhost:3001/health
```

Postgres is exposed locally on port `5433` (to avoid conflicts with an existing local Postgres).

## Create SUPER_ADMIN (seed)

Run against the Docker database:

```bash
docker compose exec \
  -e ADMIN_EMAIL="you@floridaecoservices.com" \
  -e ADMIN_PASSWORD="use-a-strong-password-min-12-chars" \
  -e ORG_NAME="Florida Eco Services" \
  api node dist/scripts/seedAdmin.js
```

Notes:
- This is idempotent (won’t duplicate the user).
- To force a password rotation, add `-e ADMIN_RESET_PASSWORD=1`.
- For now, it only creates the organization + one user.

## Auth (V1)

Endpoints:
- `POST /api/v1/auth/login` → returns `{ accessToken }` + sets `refresh_token` cookie
- `POST /api/v1/auth/refresh` → returns `{ accessToken }` + rotates `refresh_token` cookie
- `POST /api/v1/auth/logout` → clears cookie + revokes refresh token
- `GET /api/v1/auth/me` → requires `Authorization: Bearer <accessToken>`
