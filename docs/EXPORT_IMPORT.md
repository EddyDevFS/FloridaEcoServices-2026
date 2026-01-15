# Export / Import (localStorage → Postgres)

Goal: migrate existing browser data (`localStorage` key `hmp.v1`) into Postgres **without duplication**, safely rerunnable.

## 1) Export (browser)

Open `tools/export_hmp.html` in the same browser profile where you used the legacy app.

- Click “Download JSON export”
- Keep the file (example: `hmp-v1-export-2026-01-14T15-30-00-000Z.json`)

## 2) Import (backend)

The import uses `legacyId` columns to avoid duplicates on re-run.

Command (from repo root):

1) Copy the export into the container:
- `docker compose cp /path/to/hmp-v1-export-....json api:/app/import.json`

2) Run the importer:
- `docker compose exec -T api node dist/scripts/importLocalStorage.js /app/import.json`

The script prints a summary (created / skipped counts).

### Target org selection

If you have more than one organization in the DB, specify one of:
- `IMPORT_ADMIN_EMAIL="you@domain.com"` (will use that user’s org)
- `IMPORT_ORG_ID="..."` (direct org id)

Example:
- `docker compose exec -T -e IMPORT_ADMIN_EMAIL="eddy@floridaecoservices.com" api node dist/scripts/importLocalStorage.js /app/import.json`

## Notes

- If you re-run the import with the same file, it should **not create duplicates**.
- For tasks/incidents, re-run currently **skips existing items** (based on legacy task id).
