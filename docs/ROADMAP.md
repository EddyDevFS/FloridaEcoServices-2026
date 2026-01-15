# MVP Roadmap (iterate fast, cleanly)

## Goal: “operational site fast” (local-first MVP)

### 1) Unify data (priority #1)
- One JSON schema: hotels, contracts, sessions, incidents, users.
- One storage: `localStorage` (with `version` + migrations).
- Link:
  - a contract to a `hotelId`
  - an incident to `hotelId` + `roomId`
  - a session to `contractId` + list of `roomIds`

### 2) Minimal contract workflow
- Statuses: `DRAFT` → `SENT` → `ACCEPTED` → `ACTIVE` (+ `REJECTED`).
- “Send” generates a link (or token) for the hotel side.
- “Accept” on the hotel side freezes price + terms, and activates planning.

### 3) Hotel portal (v1)
- List / create incidents (with type, priority, photo later).
- Calendar view (scheduled sessions) + confirmations.
- Internal management (incidents “internal” and not shared with the provider).

### 4) Provider portal (v1)
- Contracts (list/detail) + schedule generation.
- Session planning: select rooms (from config) + print worksheet.
- Tracking: “in progress” → “completed” with notes + proof (later).

## Next step (multi-device)

Once the MVP is validated:
- Auth + backend (Supabase/Firebase/Node) to sync hotels / teams.
- Roles: `admin`, `hotel_manager`, `staff`, `provider_manager`, `technician`.
