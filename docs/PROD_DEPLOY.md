# Production deploy (Ubuntu + Docker) — floridaecoservices.com + app.floridaecoservices.com

This repo ships:
- Public site (static HTML) on `floridaecoservices.com`
- Platform (static HTML + API) on `app.floridaecoservices.com`
- API + Postgres + uploads via Docker
- HTTPS via Caddy (Let’s Encrypt)

## 0) DNS

Create/verify these records (A → your server public IP):
- `@` → `SERVER_IP`
- `www` → `SERVER_IP`
- `app` → `SERVER_IP`

Wait for propagation.

## 1) Server prerequisites (Ubuntu)

Install Docker + compose plugin.

Create a folder:

```bash
sudo mkdir -p /opt/floridaeco
sudo chown -R $USER:$USER /opt/floridaeco
cd /opt/floridaeco
```

Clone your repo (or upload it):

```bash
git clone <your-repo-url> .
```

## 2) Environment file

Create `.env` (do not commit it):

```bash
cp .env.prod.example .env
```

Fill:
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (must match the password)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `ACME_EMAIL`
- `PUBLIC_APP_URL=https://app.floridaecoservices.com`

Optional (email):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## 3) Start production stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check:

```bash
docker compose -f docker-compose.prod.yml ps
curl -sS https://app.floridaecoservices.com/health
```

## 4) Seed SUPER_ADMIN

```bash
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL="eddy@floridaecoservices.com" \
  -e ADMIN_PASSWORD="CHANGE_ME" \
  -e ORG_NAME="Florida Eco Services" \
  api node dist/scripts/seedAdmin.js
```

## 5) Smoke test (from server)

```bash
FECO_API_BASE="https://app.floridaecoservices.com" \
FECO_EMAIL="eddy@floridaecoservices.com" \
FECO_PASSWORD="CHANGE_ME" \
python3 scripts/api_smoke_test.py
```

## 6) Where to open

- Public: `https://floridaecoservices.com/`
- Platform entry: `https://app.floridaecoservices.com/` (redirects to `hotel.html`)
- Admin/contract builder: `https://app.floridaecoservices.com/admin_hotel.html`

## 7) Backups (recommended)

DB backup:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U floridaeco floridaeco > /opt/floridaeco/backups/db.sql
```

Uploads backup:
- Docker volume: `uploads_data`

