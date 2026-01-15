# Tasks inventory (frontend contract)

Source: `shared/db.js` (global `window.HMP_DB`) and UI glue in `script.js` / `hotel_tasks.html` / `hotel_task_view.html`.

## Where tasks live

- Storage: `localStorage["hmp.v1"].tasks` (map `{[taskId]: Task}`)
- Legacy: `incidents` were migrated into `tasks` if tasks is empty (compat block in `shared/db.js`).

Compat: “incidents” API is actually a wrapper over tasks:
- `listIncidentsByHotel(hotelId)` → `listTasksByHotel(hotelId)`
- `addIncident(payload)` → `addTask({ category: 'INCIDENT', ... })`
- `updateIncident/addIncidentEvent` → task variants

## Task shape (as created by `addTask(payload)`)

Required:
- `id` (string)
- `hotelId` (string)

Core fields:
- `category`: `'TASK' | 'INCIDENT' | ...` (default `'TASK'`)
- `status`: `'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED' | ...` (default `'OPEN'`)
- `type`: string (default `'OTHER'`)
- `priority`: `'NORMAL' | 'URGENT' | ...` (default `'NORMAL'`)
- `description`: string
- `assignedStaffId`: string|null
- `schedule`: object|null (UI uses for planning; exact shape TBD from `script.js`)

Locations:
- `locations`: array of objects `{ label: string, roomId?: string, spaceId?: string }` (frontend is permissive)
- `location`: single object `{ label: string }` used as preview

Timestamps:
- `createdAt` (ISO string)
- `updatedAt` (ISO string)

Events:
- `events`: array of `TaskEvent`
  - first event added at creation: action `CREATED`

Attachments:
- `attachments`: array of `TaskAttachment`
  - currently stored as `dataUrl` in localStorage (will migrate to server storage)

## TaskEvent shape (`addTaskEvent`)

- `id` (string)
- `at` (ISO string)
- `action` (string) e.g. `CREATED`, `ASSIGNED`, `UNASSIGNED`, `NOTE_ADDED`, `PHOTO_ADDED`, status changes…
- `actorRole` (string, default `'hotel_manager'`)
- `actorStaffId` (string|null)
- `note` (string)
- `patch` (object|null) e.g. `{ assignedStaffId: ... }`

## TaskAttachment shape (`addTaskAttachment`)

- `id` (string)
- `at` (ISO string)
- `name` (string)
- `mime` (string)
- `dataUrl` (string) — legacy localStorage only
- Backend V1 uses a file stored on server (`storagePath` in DB) and is served via an authenticated endpoint.
- `actorRole` (string)
- `actorStaffId` (string|null)

## Behavioral rules to keep in backend V1

- Listing endpoints must normalize:
  - missing `locations` -> derive from `location` or `room`
  - missing `events` -> `[]`
  - missing `attachments` -> `[]`
- Incidents are not a separate entity in V1: they are tasks with `category='INCIDENT'`
- Status/priority defaults must match (`OPEN`, `NORMAL`)
