# Deployment notes (later, when ready)

Oui: pour le moment on configure + valide en local. Une fois stable, on déploie sur le serveur Ubuntu.

## Local (today)

- Start stack: `docker compose up -d --build`
- API: `http://localhost:3001/health`
- DB: `localhost:5433` (local only)

## Server (later)

Target:
- `api.app.floridaecoservices.com` (or `/api` behind Nginx)
- `app.floridaecoservices.com` for the authenticated app UI
- `floridaecoservices.com` stays for the public marketing site

Server building blocks:
- Docker + docker compose
- Nginx reverse proxy + TLS (Let’s Encrypt)
- Postgres volume + scheduled backups
- Uploads volume for photos (persist on disk)

DNS:
- Add `A` record: `app` → server IP
- (Optionally) add `A` record: `api` → server IP

We will write the final Nginx config once we decide the exact URL layout (`/api` vs `api.`).

