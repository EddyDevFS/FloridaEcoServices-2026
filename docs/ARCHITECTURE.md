# Architecture (prototype)

## Current surfaces

1) Landing (marketing)
- Files: `index.html`, `home.css`, `home.js`
- Goal: present the product and redirect to the app.

2) Admin – Hotel setup
- Files: `index_old.html`, `styles.css`, `script.js`
- Already solid features:
  - building → floor → rooms + spaces hierarchy
  - quick setup (generation), bulk add, multi-select, JSON export
  - modern and consistent UI
- Storage: multi-hotel local storage (`hmp.config.v1`)

3) Provider – Business cockpit
- Files: `MAINTENANCE_PRO/DASHBOARD/dashboard-pro.html`, `MAINTENANCE_PRO/CONTRACTS/contracts.html`
- Dependencies: `MAINTENANCE_PRO/CORE/database.js`, `MAINTENANCE_PRO/CORE/navigation.js`
- Note: `dashboard-pro.html` uses Chart.js via CDN.

## Key alignment point

Today:
- hotel configuration lives in `script.js` + `localStorage hmp.config.v1`
- contracts/sessions/issues live in `window.HotelDB` + `localStorage hotel-maintenance-pro`

Recommended foundation:
- define a “single source of truth” (one schema + one local storage)
- expose a simple JS API (e.g. `DB.hotels.list()`, `DB.contracts.add()`, `DB.issues.report()`)
- progressively migrate both UIs onto that API
