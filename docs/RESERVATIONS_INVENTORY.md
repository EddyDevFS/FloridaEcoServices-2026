# Reservations inventory (frontend contract)

Source of truth (current): `shared/db.js` + usage in `script.js` and `reservation_view.html`.

## Reservation object (stored)

Created by `window.HMP_DB.createReservation(payload)`:
- `id`: string (generated)
- `token`: string (generated, shared link uses `reservation_view.html?token=...`)
- `statusAdmin`: `"PROPOSED" | "PENDING" | "APPROVED" | "CANCELLED"` (default `"PROPOSED"`)
- `statusHotel`: `"PROPOSED" | "PENDING" | "APPROVED" | "CANCELLED"` (default `"PENDING"`)
- `createdAt`: ISO string
- `confirmedAt`: ISO string (set when a side clicks “Approve”)
- `cancelledAt`: ISO string (set on cancel)
- `cancelledBy`: `"admin" | "hotel" | string` (frontend uses `"admin"` today)
- `cancelReason`: string
- `requiresAdminApproval`: boolean (set when date/time changed by one side)

Wizard payload fields (from `script.js`):
- `hotelId`: string
- `roomIds`: string[] (may be empty)
- `spaceIds`: string[] (may be empty)
- `roomNotes`: `{ [roomId: string]: string }`
- `spaceNotes`: `{ [spaceId: string]: string }`
- `surfaceDefault`: `"BOTH" | "CARPET" | "TILE"`
- `roomSurfaceOverrides`: `{ [roomId: string]: "BOTH" | "CARPET" | "TILE" }`
- `notesGlobal`: string
- `notesOrg`: string
- `durationMinutes`: number
- `proposedDate`: string (`YYYY-MM-DD`)
- `proposedStart`: string (`HH:MM`)

## State machine (as used by `reservation_view.html`)

Key rules:
- Cancelled if `statusAdmin === "CANCELLED"` OR `statusHotel === "CANCELLED"` OR `cancelledAt` set.
- “Approve” updates only one side:
  - admin role: `statusAdmin = "APPROVED"`
  - hotel role: `statusHotel = "APPROVED"`
  - also sets `confirmedAt` and persists `notesOrg`.
- “Propose changes” updates `proposedDate/proposedStart` and resets statuses:
  - if changed:
    - admin role: `statusAdmin = "PROPOSED"`, `statusHotel = "PENDING"`
    - hotel role: `statusHotel = "PROPOSED"`, `statusAdmin = "PENDING"`
    - sets `requiresAdminApproval = true`
  - if unchanged: sets the current side to `"APPROVED"` (frontend convenience)

## Scheduling rules (as used by `script.js`)

`isDateBlocked(date)` returns true if:
- any blocked slot exists for that date (`window.HMP_DB.listBlockedSlots()`), OR
- any reservation exists for that date where both sides are approved.

