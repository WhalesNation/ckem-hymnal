# CKEM Int'l — Digital Sacred Hymnal

Offline-first Progressive Web App (PWA) digital hymnal built for **CKEM Int'l**.

## Features
- **Instant Multi-Hymnal Search & Filtering:** Search by hymn number, title, chorus, or lyrics across `CAC`, `TAC`, `RCCG`, `SS&S`, `Choruses / Indigenous`, and `Favorites`.
- **Interactive 3D Animations:** Mouse/touch-reactive 3D hymnbook cover, 3D card hover lift, and 3D page-flip transitions in the hymn reader.
- **Sanctuary-Friendly Controls:** Light/Dark theme toggle, adjustable font scale (`A-` / `100%` / `A+`), and Screen Wake Lock (`Screen On`).
- **Offline PWA Support:** Caches app files and `hymns.json` via `sw.js` (`manifest.json` + `icon.svg`).
- **Manual Entry & JSON Backup:** Add/edit hymns in the browser and export `hymns.json` to publish updates to the repository.

## Publishing Updates to GitHub Pages
1. Add or edit hymns in the app and click **Bulk JSON Import / Export -> Export Backup (.json)** to download `hymns.json`.
2. Replace `hymns.json` in this repository with the exported file.
3. Bump `CACHE_NAME` in `sw.js` (e.g., `ckem-hymnal-cache-v2`) and commit/push to `main`.
