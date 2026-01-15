# Blocked slots inventory (frontend contract)

Source of truth (current): `shared/db.js` + `script.js` (settings/planning).

## Blocked slot object (stored)

Created by `window.HMP_DB.addBlockedSlot(payload)`:
- `id`: string (generated)
- `date`: string (`YYYY-MM-DD`)
- `start`: string (`HH:MM`)
- `end`: string (`HH:MM`)
- `note`: string
- `createdAt`: ISO string

## Listing / delete

- `window.HMP_DB.listBlockedSlots()` returns an array
- `window.HMP_DB.deleteBlockedSlot(slotId)` removes it

