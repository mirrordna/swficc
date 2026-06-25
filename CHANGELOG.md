# Changelog

## 2026-06-22

### Changed
- Deployed SWFIPN acceptance releases `/opt/swfipn-acceptance/releases/20260622T090737Z` and final closeout release `/opt/swfipn-acceptance/releases/20260622T092601Z`.
- Changed public dashboard record links to canonical SWFI record URLs (`/v1/entities`, `/v1/transactions`, `/v1/compass`, and legacy `?p=` news links) instead of internal SWFIPN detail placeholders.
- Reworked Active Allocators to match KP's Java implementation: entity updates from `entities`, 30/60/90-day windows, AUM and/or managed-assets update mode, `activity_reason`, `activity_count`, and `most_recent_activity_date`.
- Updated Active Allocator dashboard/list labels from deal-count language to activity-update language.
- Hardened the Phase 1 gate so it fails internal mirror detail links and verifies logged-out canonical SWFI record navigation reaches SWFI sign-in.
- Guarded the pre-rendered dashboard snapshot so stale packets are ignored instead of silently showing old allocator data before hydration.

### Verified
- `python3 -m py_compile /Users/mirror-pro/repos/SWFI2.0-final/src/swfi2_final/services/vault.py /Users/mirror-pro/repos/SWFI2.0-final/src/swfi2_final/app.py`
- `npm run build`
- Public `/swficc/` returns `200` with asset version `2026-06-22T090820623Z`.
- Public `/api/allocator-activity/v1?days=90&limit=3&sort=activity_count&direction=desc` returns Java-style allocator rows and `count=547`.
- Public `/swficc/` raw HTML contains no stale `2447` allocator count, old VC allocator rows, old transaction-based allocator formula, or internal record-detail links.
- `npm run phase1:gate:public` passed with 50 canonical SWFI record links: 20 entity, 10 transaction, 10 Compass, and 10 legacy news links.
- `npm run list:data:proof:public` passed for profiles, people, transactions, deals, mandates, and research using canonical SWFI row-link checks.
- `npm run data:validation:gate:public` passed with 8 modules and 0 failed modules.
- `npm run closeout:gate:public` passed dashboard, API freshness, list-page controls, canonical links, and logged-out SWFI sign-in redirects. Credentialed SWFI login return was skipped because no secure credential environment was supplied to the gate.
- `npm run source-url:coverage:public` passed with backend record URL families: 595,095 entities, 131,640 people, 181,261 transactions, 4,876 Compass records, and 17,656 news records.
- Final public `/swficc/` serves asset version `2026-06-22T092705663Z`.
- Unauthenticated canonical SWFI entity URL returns `302` to `/v1/signin/?msg=auth&redirect=/v1/entities/...`.

## 2026-06-21

### Changed
- Cut over `swfipn.activemirror.ai` from the Cloudflare Tunnel recovery record to the DigitalOcean acceptance droplet `161.35.56.218`.
- Deployed SWFIPN acceptance release `/opt/swfipn-acceptance/releases/20260621T124226Z`.
- Hardened the DigitalOcean deploy script to use the stable Compose project name `swfipn_acceptance`.
- Added a read-only DigitalOcean inventory command: `npm run do:inventory`.
- Deployed auth-return bridge release `/opt/swfipn-acceptance/releases/20260621T130617Z`.
- Changed `/swficc/login/` to redirect to SWFI signin with `msg=auth` and a sanitized `redirect=` target back to the requested `swfipn.activemirror.ai/swficc/...` route.
- Hardened the Phase 1 public dashboard gate so it fails if SWFI signin loses the return target or accepts an unsafe external `next` URL.

### Verified
- Public `/swficc/` serves asset version `2026-06-21T124325893Z`.
- Public `/swficc/` serves asset query version `2026-06-21T130702704Z` after auth-return bridge deploy.
- Public source-data API returns Mongo-backed entity data with `count=595095`.
- Public gates passed: `list:data:proof:public`, `data:validation:gate:public`, `phase1:gate:public`, `link:escape:gate:public`, `detail-depth:gate:public`, `record-mirror:gate:public`.
- Public `/swficc/login/` redirects to `https://www.swfi.com/v1/signin/?msg=auth&redirect=https%3A%2F%2Fswfipn.activemirror.ai%2Fswficc%2F`.
- Public `/swficc/login/?next=%2Fswficc%2Fprofiles%2F` redirects to SWFI signin with `redirect=https%3A%2F%2Fswfipn.activemirror.ai%2Fswficc%2Fprofiles%2F`.
- Public `/swficc/login/?next=https%3A%2F%2Fevil.com%2F` sanitizes the return target back to `https://swfipn.activemirror.ai/swficc/`.

### Known Follow-Up
- Older auth/acceptance gate scripts need Phase 1 contract cleanup. The current public runtime intentionally has no custom dashboard auth: `/swficc/login/` redirects to SWFI signin with a sanitized SWFIPN return target, and `/api/session/status/v1` is not exposed by this static dashboard stack.
- `mirrorgraph:gate:public` still expects the stale local login form selector `input[name="username"]`.
