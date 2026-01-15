# Florida Eco Services — Migration plan (API + DB + Deploy)

Objectif: migrer le prototype front actuel vers une application avec backend/API + base de données (Postgres) **sans régression** et avec une transition progressive (fallback localStorage → double-write → API-only).

Ce document sert de **source unique** pour:
- l’ordre exact des travaux,
- l’état d’avancement (à cocher),
- les critères d’acceptation (Definition of Done),
- les risques et décisions.

## Règles de suivi

- Chaque item a un identifiant unique `Mxx` (milestone) / `Txx.yy` (task).
- On ne coche `[x]` que si les critères “DoD” sont remplis.
- Si une décision change, noter dans “Décisions” + update des tâches impactées.
- On garde un “journal” court des changements.

### Statuts

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked (expliquer le blocage)

## Hypothèses V1 (validées)

- Une app unique “Florida Eco” (super admin) qui gère plusieurs hôtels.
- Auth V1: email/password (simple + sécurisée).
- Photos: upload + réduction de taille + stockage sur disque serveur Ubuntu (Docker).
- Domaine: `floridaecoservices.com`.
- Front: on garde l’existant (vanilla) pour éviter toute casse; migration progressive.

## Décisions (à compléter)

- Stack backend: `TBD` (Node TS + NestJS/Express), ORM `TBD` (Prisma), DB `PostgreSQL`.
- Hébergement app: `TBD` `app.floridaecoservices.com` (recommandé) ou `/app`.
- Stockage uploads: `TBD` (dossier docker volume: ex `/var/app/uploads`).

## Milestones & tâches

### M01 — Audit & gel du comportement (zéro régression)

- [~] T01.01 Inventaire des pages/flows existants (admin, hotel, staff, tasks, incidents, agenda)
  - DoD: liste des pages + actions principales + dépendances `localStorage`/fichiers.
- [x] T01.02 Inventaire des clés `localStorage` + schéma de données actuel
  - DoD: docs: `docs/FRONTEND_INVENTORY.md`, `docs/TASKS_INVENTORY.md`, `docs/STAFF_INVENTORY.md`, `docs/RESERVATIONS_INVENTORY.md`, `docs/SESSIONS_INVENTORY.md`.
- [ ] T01.03 Définir les rôles V1 + permissions minimales
  - DoD: table rôles → permissions (lecture/écriture) par ressource.
- [ ] T01.04 Checklist de tests manuels (smoke tests) sur le front actuel
  - DoD: une liste exécutable (10–30 points) utilisée à chaque milestone.

### M02 — Infra dev: API + Postgres en Docker (local)

- [x] T02.01 Créer dossier backend (ou repo) + structure projet
  - DoD: `docker compose up` démarre `api` + `db`.
- [x] T02.02 Endpoint healthcheck + logs
  - DoD: `GET /health` 200 + logs JSON par requête.
- [x] T02.03 Migrations DB automatisées
  - DoD: migrations appliquées au boot (ou command) sans action manuelle.

### M03 — Modèle de données V1 (Postgres)

Tables (cible) à valider dans les tasks:
- `organizations` (Florida Eco)
- `users` (+ refresh tokens / sessions)
- `hotels`
- `buildings`, `floors`, `rooms`, `spaces`
- `staff_members`
- `tasks` (+ historique `task_events`)
- `incidents` (+ `comments`)
- `attachments` (photos)
- `contracts` (+ token signature)
- `pricing_defaults`
- `audit_logs`

- [x] T03.01 Schéma DB v1 + relations + indexes
  - DoD: migrations appliquées au boot + indexes clés (hotels, tasks, staff, reservations/sessions).
- [ ] T03.02 Multi-tenant scoping “hard”
  - DoD: aucune table métier sans `organization_id` et/ou `hotel_id` (selon design).

### M04 — Auth & sécurité V1

- [x] T04.01 Auth email/password (hash + policies)
  - DoD: create user + login + logout + refresh, mots de passe hashés.
- [~] T04.02 RBAC (roles)
  - DoD: guards/middlewares + tests d’accès (403 correct).
- [ ] T04.03 Sécurité baseline
  - DoD: rate limiting, CORS strict, headers, validation input, erreurs standardisées.
- [ ] T04.04 Audit logs (actions sensibles)
  - DoD: log minimal (qui/quoi/quand) sur créations/suppressions/import/export.

### M05 — API V1 (CRUD) “core”

- [x] T05.01 Hotels CRUD + sélection hôtel actif
  - DoD: endpoints stables + validation + pagination si besoin.
- [x] T05.02 Structure CRUD (buildings/floors/rooms/spaces)
  - DoD: endpoints + filtres par hôtel.
- [x] T05.02.01 Bulk rooms generation
  - DoD: endpoint pour créer N rooms en 1 call, idempotent-ish.
- [x] T05.03 Tasks (create/list/update/events)
  - DoD: endpoints alignés sur `shared/db.js` + smoke test.
- [x] T05.04 Staff (create/list/update)
  - DoD: endpoints alignés sur `shared/db.js` + token pour staff portal.
- [x] T05.05 Reservations (create/list/update/cancel/delete + token link)
  - DoD: endpoints + migration + smoke test.
- [x] T05.06 Planning primitives (blocked slots, technicians, sessions)
  - DoD: endpoints + migration + smoke test.
- [x] T05.07 Contracts/pricing (defaults + contract token signature)
  - DoD: endpoints + migration + smoke test.
- [x] T05.08 Incidents CRUD + commentaires
  - DoD: incidents stored as `Task(category=INCIDENT)` + endpoints + smoke test.

### M06 — Photos (upload + resize + stockage disque)

- [x] T06.01 Endpoint upload multipart sécurisé
  - DoD: limite taille, mime whitelist, auth obligatoire.
- [x] T06.02 Resize/compression (server-side)
  - DoD: image optimisée + original optionnel (décision).
- [~] T06.03 Stockage local + URLs servies via Nginx
  - DoD: fichiers persistants via volume docker + accès contrôlé (au minimum par URL non-indexée).
- [x] T06.04 Attachment lié à task/event
  - DoD: DB enregistre `task_id`/`event_id`, chemin, taille, dimensions, auteur, date.

### M07 — Migration des données (ne rien perdre)

- [~] T07.01 Export JSON depuis le front actuel (localStorage → fichier)
  - DoD: export contient toutes les entités requises (`tools/export_hmp.html`).
- [~] T07.02 Import backend (JSON → Postgres) idempotent
  - DoD: import relançable sans duplications; rapport final (counts) (`backend/src/scripts/importLocalStorage.ts`).
- [x] T07.03 Mode “shadow” (lecture API + fallback local)
  - DoD: feature-flag (query params `mode/api`), endpoints export/import, smoke test + doc `docs/SHADOW_MODE.md`.
- [ ] T07.04 Double-write (local + API) sur un périmètre limité
  - DoD: logs erreurs; comparaison de données sur 1–2 semaines (ou période de test).
- [ ] T07.05 Basculer API-only
  - DoD: localStorage plus source de vérité; export reste disponible en secours.

### M08 — Déploiement Ubuntu (staging → prod) + hardening

- [ ] T08.01 Staging sur `staging.floridaecoservices.com`
  - DoD: déploiement docker complet + TLS + accès restreint.
- [ ] T08.02 Backups & restore test
  - DoD: backup Postgres programmé + test restauration documenté.
- [ ] T08.03 Monitoring minimum
  - DoD: healthchecks + logs + alerting basique.
- [ ] T08.04 Cutover prod (plan de bascule + rollback)
  - DoD: plan minute par minute + rollback défini (DB snapshot + retour ancien front).

## Journal (changelog)

- 2026-01-13: création du plan de migration V1.
