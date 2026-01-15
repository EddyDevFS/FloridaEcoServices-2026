# Incidents inventory (frontend contract)

Important: in the current frontend, “incidents” are legacy/compat wrappers around “tasks”.
Source of truth: `shared/db.js` (compat block) + `script.js` (initHotelIncidents).

## Incident object (frontend expectations)

Created by `window.HMP_DB.addIncident(payload)` which internally calls `addTask({... category:'INCIDENT' ...})`.

Fields used by UI:
- `id`: string
- `hotelId`: string
- `category`: usually `"INCIDENT"`
- `type`: string (default `"OTHER"`)
- `priority`: `"NORMAL" | "URGENT"`
- `status`: `"OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"`
- `room`: string (free text “Room or area”)
- `description`: string
- `assignedStaffId`: string|null
- `events`: array (used for history popup, last 10 lines)

Backend V1 maps `room` to `locations[0].label` on the underlying task row.

## Legacy API surface in `shared/db.js`

- `listIncidentsByHotel(hotelId)`
- `addIncident(payload)`
- `addIncidentEvent(incidentId, payload)`
- `updateIncident(incidentId, patch)`
- `listIncidentsByStaff(staffId)`

