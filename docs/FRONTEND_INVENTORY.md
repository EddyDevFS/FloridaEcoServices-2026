# Frontend inventory (source of truth for V1 backend)

Goal: the backend must match what the current frontend already does (localStorage + JS DB), then we migrate progressively without breaking anything.

## Current “DB” sources

### A) Admin + hotel UI (multi-hotel config)

- File: `shared/db.js` (global `window.HMP_DB`)
- Storage key (current): `localStorage["hmp.v1"]`
- Legacy key (migrated on read): `localStorage["hmp.config.v1"]`

Top-level shape (`hmp.v1`):
- `version` (number)
- `activeHotelId` (string|null)
- `hotels` (map `{[hotelId]: Hotel}`)
- `contracts`, `sessions`, `reservations`, `incidents`, `tasks`, `staff`, `technicians` (maps)
- `availability.blocked` (array)
- `settings.timezone`, `settings.workHours`
- `pricing.defaults` (pricing config)

Hotel shape (created by `createHotel`):
- `id` (string, like `hotel-...`)
- `name` (string)
- `buildings` (array)

In demo seeding (`shared/demo.js`), buildings/floors/rooms/spaces look like:
- `building`: `{ id, name, notes, floors: Floor[] }`
- `floor`: `{ id, nameOrNumber, rooms: Room[], spaces: Space[] }`
- `room`: `{ id, roomNumber, active, surface, sqft, cleaningFrequency, lastCleaned }`
- `space`: `{ id, name, sqft, active }`

### B) Provider cockpit (business/contracts)

- File: `MAINTENANCE_PRO/CORE/database.js` (global `window.HotelDB`)
- Storage key: `localStorage["hotel-maintenance-pro"]`

Contains: contracts, maintenance issues, sessions, pricing reference.

## Keys we must preserve in V1

To avoid breaking migration, V1 backend must support at minimum:
- Multi-hotel under one org (Florida Eco)
- Structure hierarchy: building → floor → rooms/spaces
- Planning primitives (tasks/incidents/sessions) (next milestone)
- Pricing defaults (later, but schema must allow it)

## Notes

- Current IDs are generated client-side (`prefix-DateNow-rand`).
- Backend V1 can keep server-side ids, but we need a clean mapping/import strategy during migration.

