# Frontend → Backend mapping (V1)

This document maps what the current frontend stores/does to the backend schema + endpoints.

## Auth (new in backend)

Backend endpoints:
- `POST /api/v1/auth/login` → `{ accessToken }` + sets `refresh_token` cookie
- `POST /api/v1/auth/refresh` → `{ accessToken }` + rotates `refresh_token` cookie
- `POST /api/v1/auth/logout` → `{ ok:true }` + clears cookie
- `GET /api/v1/auth/me` → `{ user }` (requires `Authorization: Bearer <token>`)

DB:
- `User`, `Organization`, `RefreshToken`

## Hotels (maps to `HMP_DB.hotels`)

Frontend (`shared/db.js`):
- `HMP_DB.getHotels()`, `createHotel(name)`, `renameHotel`, `setActiveHotelId`

Backend endpoints:
- `GET /api/v1/hotels` → list hotels for current org
- `POST /api/v1/hotels` → create hotel (SUPER_ADMIN)
- `PATCH /api/v1/hotels/:hotelId` → rename hotel (SUPER_ADMIN)

DB:
- `Hotel` (scoped by `organizationId`)

## Staff (implemented V1)

Frontend (`shared/db.js`):
- `listStaffByHotel(hotelId, { includeInactive })`, `addStaff`, `updateStaff`, `getStaffByToken(token)`

Backend endpoints:
- `GET /api/v1/hotels/:hotelId/staff?includeInactive=1` → `{ staff }`
- `POST /api/v1/hotels/:hotelId/staff` → `{ staff }`
- `PATCH /api/v1/staff/:staffId` → `{ staff }`
- `GET /api/v1/staff/:staffId/tasks` → `{ tasks }`
- `GET /api/v1/staff/by-token/:token` → `{ staff }` (auth required for now)

DB:
- `StaffMember` (includes `token` for staff portal links)

## Structure (maps to hotel.buildings[])

Frontend:
- `building -> floors -> rooms/spaces`

Backend endpoints:
- `GET /api/v1/hotels/:hotelId/buildings`
- `POST /api/v1/hotels/:hotelId/buildings`
- `PATCH /api/v1/buildings/:buildingId`
- `DELETE /api/v1/buildings/:buildingId`
- `GET /api/v1/buildings/:buildingId/floors`
- `POST /api/v1/buildings/:buildingId/floors`
- `PATCH /api/v1/floors/:floorId`
- `DELETE /api/v1/floors/:floorId`
- `GET /api/v1/floors/:floorId/rooms`
- `POST /api/v1/floors/:floorId/rooms`
- `POST /api/v1/floors/:floorId/rooms/bulk`
- `PATCH /api/v1/rooms/:roomId`
- `DELETE /api/v1/rooms/:roomId`
- `GET /api/v1/floors/:floorId/spaces`
- `POST /api/v1/floors/:floorId/spaces`
- `PATCH /api/v1/spaces/:spaceId`
- `DELETE /api/v1/spaces/:spaceId`
- `GET /api/v1/hotels/:hotelId/structure` (nested buildings→floors→rooms/spaces)

DB:
- `Building`, `Floor`, `Room`, `Space`

## Next (not implemented yet)

- Export/import tools to migrate localStorage to Postgres

Tasks contract details: `docs/TASKS_INVENTORY.md`.
Staff contract details: `docs/STAFF_INVENTORY.md`.
Reservations contract details: `docs/RESERVATIONS_INVENTORY.md`.
Sessions contract details: `docs/SESSIONS_INVENTORY.md`.
Technicians contract details: `docs/TECHNICIANS_INVENTORY.md`.
Blocked slots contract details: `docs/BLOCKED_SLOTS_INVENTORY.md`.
Contracts contract details: `docs/CONTRACTS_INVENTORY.md`.
Pricing defaults contract details: `docs/PRICING_DEFAULTS_INVENTORY.md`.
Incidents contract details: `docs/INCIDENTS_INVENTORY.md`.

## Tasks (implemented V1)

Backend endpoints:
- `GET /api/v1/hotels/:hotelId/tasks` → `{ tasks }`
- `POST /api/v1/hotels/:hotelId/tasks` → `{ task }` (creates default `CREATED` event)
- `PATCH /api/v1/tasks/:taskId` → `{ task }`
- `POST /api/v1/tasks/:taskId/events` → `{ event }`

DB:
- `Task`, `TaskLocation`, `TaskEvent`, `TaskAttachment` (attachments are placeholder v1; server uploads later)

## Task photos (implemented V1)

Backend endpoints:
- `POST /api/v1/tasks/:taskId/attachments` (multipart form-data, field `file`) → `{ attachment }` with `url`
- `GET /api/v1/tasks/:taskId/attachments/:attachmentId/file` → streams the image (auth required)
- `GET /api/v1/tasks/:taskId/attachments` → `{ attachments }`
- `DELETE /api/v1/tasks/:taskId/attachments/:attachmentId` → `{ ok:true }`

## Task detail (implemented V1)

Backend endpoints:
- `GET /api/v1/tasks/:taskId` → `{ task }` (includes locations, events, attachments with `url`)

## Contracts + pricing (implemented V1)

Pricing defaults:
- `GET /api/v1/pricing/defaults` → `{ defaults }` (lazy-create per org)
- `PATCH /api/v1/pricing/defaults` → `{ defaults }` (SUPER_ADMIN)

Contracts:
- `GET /api/v1/hotels/:hotelId/contracts` → `{ contracts }`
- `POST /api/v1/hotels/:hotelId/contracts` → `{ contract }` (SUPER_ADMIN, creates token)
- `PATCH /api/v1/contracts/:contractId` → `{ contract }` (SUPER_ADMIN)
- `DELETE /api/v1/contracts/:contractId` → `{ ok:true }` (SUPER_ADMIN)
- `GET /api/v1/contracts/by-token/:token` → `{ contract }` (public link)
- `POST /api/v1/contracts/by-token/:token/accept` → `{ contract }` (public signature)

DB:
- `PricingDefaults`, `Contract`

## Incidents (implemented V1)

Incidents are stored as tasks with `category = "INCIDENT"`.

Backend endpoints (compat layer):
- `GET /api/v1/hotels/:hotelId/incidents` → `{ incidents }`
- `POST /api/v1/hotels/:hotelId/incidents` → `{ incident }` (maps `room` → `locations[0].label`)
- `GET /api/v1/incidents/:incidentId` → `{ incident }`
- `PATCH /api/v1/incidents/:incidentId` → `{ incident }`
- `POST /api/v1/incidents/:incidentId/events` → `{ event }`
- `GET /api/v1/staff/:staffId/incidents` → `{ incidents }`

DB:
- `Task`, `TaskLocation`, `TaskEvent`

## Reservations (implemented V1)

Frontend (`shared/db.js`):
- `listReservations`, `listReservationsByHotel`, `createReservation`, `updateReservation`, `cancelReservation`, `deleteReservation`, `getReservationByToken`

Backend endpoints:
- `GET /api/v1/hotels/:hotelId/reservations` → `{ reservations }`
- `POST /api/v1/hotels/:hotelId/reservations` → `{ reservation }` (creates token)
- `PATCH /api/v1/reservations/:reservationId` → `{ reservation }`
- `POST /api/v1/reservations/:reservationId/cancel` → `{ reservation }`
- `DELETE /api/v1/reservations/:reservationId` → `{ ok:true }` (SUPER_ADMIN)
- `GET /api/v1/reservations/by-token/:token` → `{ reservation }` (public link)
- `PATCH /api/v1/reservations/by-token/:token` → `{ reservation }` (limited, hotel-side)
- `POST /api/v1/reservations/by-token/:token/cancel` → `{ reservation }` (hotel-side)

DB:
- `Reservation`

## Planning primitives (implemented V1)

Blocked slots:
- `GET /api/v1/blocked-slots` → `{ blockedSlots }`
- `POST /api/v1/blocked-slots` → `{ blockedSlot }` (SUPER_ADMIN)
- `DELETE /api/v1/blocked-slots/:slotId` → `{ ok:true }` (SUPER_ADMIN)

Technicians:
- `GET /api/v1/technicians` → `{ technicians }`
- `POST /api/v1/technicians` → `{ technician }` (SUPER_ADMIN)
- `PATCH /api/v1/technicians/:technicianId` → `{ technician }` (SUPER_ADMIN)
- `DELETE /api/v1/technicians/:technicianId` → `{ ok:true }` (SUPER_ADMIN)

Sessions:
- `GET /api/v1/hotels/:hotelId/sessions` → `{ sessions }`
- `POST /api/v1/hotels/:hotelId/sessions` → `{ session }`

DB:
- `BlockedSlot`, `Technician`, `Session`
