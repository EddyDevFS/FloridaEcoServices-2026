# Contracts inventory (frontend contract)

Source of truth (current): `shared/db.js` + `script.js` (contract builder) + `contract_view.html` (token link + signature).

## Contract object (stored)

Created by `window.HMP_DB.createContract(payload)`:
- `id`: string (generated)
- `token`: string (generated; link uses `contract_view.html?token=...`)
- `status`: `"SENT" | "ACCEPTED"` (default `"SENT"`)
- `createdAt`: ISO string
- payload fields (from `script.js`):
  - `hotelId`: string
  - `hotelName`: string
  - `contact`: `{ name: string, email: string, cc: string[] }`
  - `pricing`: `{ basePrices, penaltyPrices, contractPrices, advantagePrices, sqftPrices }`
    - `basePrices`: `{ BOTH:number, CARPET:number, TILE:number }`
    - `penaltyPrices`: `{ BOTH:number, CARPET:number, TILE:number }`
    - `contractPrices`: `{ BOTH:number, CARPET:number, TILE:number }`
    - `advantagePrices`: `{ BOTH:number, CARPET:number, TILE:number }`
    - `sqftPrices`: `{ CARPET:number, TILE:number }`
  - `roomsMinPerSession`: number
  - `roomsMaxPerSession`: number
  - `roomsPerSession`: number
  - `frequency`: `"YEARLY" | "TWICE_YEAR"`
  - `surfaceType`: `"BOTH" | "CARPET" | "TILE"`
  - `appliedTier`: string
  - `appliedPricePerRoom`: number
  - `otherSurfaces`: `{ carpetSqft:number, tileSqft:number }`
  - `totalPerSession`: number
  - `notes`: string
  - `sentAt`: ISO string

Signature fields (set by `contract_view.html`):
- `signedBy`: string
- `acceptedAt`: ISO string

