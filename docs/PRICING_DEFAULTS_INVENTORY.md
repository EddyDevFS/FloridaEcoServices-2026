# Pricing defaults inventory (frontend contract)

Source of truth (current): `shared/db.js` (`pricing.defaults`) + `script.js` (contract builder sync).

Stored under `hmp.v1.pricing.defaults`:
- `roomsMinPerSession`: number (default `10`)
- `roomsMaxPerSession`: number (default `20`)
- `basePrices`: `{ BOTH:number, CARPET:number, TILE:number }`
- `penaltyPrices`: `{ BOTH:number, CARPET:number, TILE:number }`
- `contractPrices`: `{ BOTH:number, CARPET:number, TILE:number }`
- `advantagePrices`: `{ BOTH:number, CARPET:number, TILE:number }`
- `sqftPrices`: `{ CARPET:number, TILE:number }`

Updated by UI via `window.HMP_DB.setPricingDefaults(next)` (merge patch).

