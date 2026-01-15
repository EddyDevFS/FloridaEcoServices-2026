# Hosting de l’app: `/app` vs `app.` (recommandation)

Tu as 2 options valides. La différence principale: **simplicité** et **risque de bug de chemins**.

## Option A — `floridaecoservices.com/app` (pas besoin de DNS)

✅ Avantages
- Pas de sous-domaine à créer.
- Un seul domaine (cookies plus simples si on fait une auth par cookie).

⚠️ Points d’attention
- Il faut que l’app (frontend) supporte un “base path” `/app` (assets, routing, liens).
- Les SPA (si un jour React/Vue) ont souvent besoin d’un réglage explicite de base path.

Nginx (exemple)
- `/` → site public (statique)
- `/app/` → app (statique) ou reverse proxy vers un serveur
- `/api/` → backend API

## Option B — `app.floridaecoservices.com` (recommandé)

✅ Avantages
- Beaucoup plus simple (pas de base path).
- Moins de risques (assets/routing).
- Séparation claire public vs app.

⚠️ Prérequis
- Ajouter un DNS record `app` (A ou CNAME).

## Recommandation V1 “zéro casse”

- Si tu veux **le minimum de surprises**, on vise `app.floridaecoservices.com`.
- Si tu veux absolument rester sur `/app`, on le fait, mais on garde une checklist “base path” et on teste plus.

## DNS (pour `app.floridaecoservices.com`)

Chez ton registrar/DNS provider, ajoute un record:
- Type: `A`
- Name/Host: `app`
- Value: l’IP publique de ton serveur Ubuntu
- TTL: auto / 300s

(Alternative si tu as déjà un record `A` pour le root et que ton provider le permet: `CNAME app -> floridaecoservices.com`.)
