# Sessions inventory (frontend contract)

Source of truth (current): `shared/db.js` + `script.js` (planning modal).

## Session object (stored)

Created by `window.HMP_DB.createSession(payload)`:
- `id`: string (generated)
- `status`: `"SCHEDULED"` (default)
- `createdAt`: ISO string
- payload fields:
  - `hotelId`: string
  - `roomIds`: string[]
  - `date`: string (`YYYY-MM-DD`)
  - `start`: string (`HH:MM`)
  - `end`: string (`HH:MM`)
  - `technicianId`: string (may be empty)

## Listing

`window.HMP_DB.listSessionsByHotel(hotelId)` returns all sessions with matching `hotelId`.

