# Technicians inventory (frontend contract)

Source of truth (current): `shared/db.js` + `script.js` (settings page).

## Technician object (stored)

Created by `window.HMP_DB.addTechnician(payload)`:
- `id`: string (generated)
- `name`: string (required in UI)
- `phone`: string
- `notes`: string
- `active`: boolean (default `true`)
- `createdAt`: ISO string

## Listing / updates

- `window.HMP_DB.listTechnicians()`
- `window.HMP_DB.updateTechnician(techId, patch)`
- `window.HMP_DB.deleteTechnician(techId)`

