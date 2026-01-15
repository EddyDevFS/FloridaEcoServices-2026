# Staff inventory (frontend contract)

Source: `shared/db.js` + staff UI flows in `script.js` (`initHotelStaff`, `initStaffTasks`).

## Staff shape (as created by `addStaff(payload)` in `shared/db.js`)

- `id` (string)
- `token` (string) used for staff portal links (`?token=...`)
- `hotelId` (string)
- `firstName` (string)
- `lastName` (string)
- `phone` (string)
- `notes` (string)
- `active` (boolean)
- `createdAt` (ISO string)

## Behaviors used by UI

- List staff for hotel (default excludes inactive)
- Toggle `active` true/false
- Resolve staff identity by URL token: `getStaffByToken(token)`
- Staff tasks view filters tasks by `assignedStaffId` + active hotel.

