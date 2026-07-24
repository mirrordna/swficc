# Changelog

## 2026-06-27

### Added
- Added Admin Governance backend/UI proof for organizations, users, roles/permissions, and content workflow records.
- Added Admin Governance BRD gate: `npm run brd:admin-governance:gate:public`.
- Added Saved Searches linked in-app alert delivery receipts through `POST /api/v1/saved-searches/{id}/alert-deliveries/test`.
- Added Saved Searches UI `Test Alert` flow for alert-enabled saved searches, backed by stored delivery receipts.
- Added Alert Delivery Receipts BRD gate: `npm run brd:alert-delivery:gate:public`.
- Added SendGrid email delivery provider wiring in the backend and a public SendGrid email gate: `npm run brd:sendgrid-email:gate:public`.
- Added SWFI session bridge callback/gate: `/swficc/auth/bridge/` and `npm run brd:swfi-session:gate:public`.
- Added DigitalOcean runtime config applicator: `npm run runtime:config:apply`. It applies only supplied SWFI session bridge and SendGrid runtime variables, redacts values from receipts, and fails closed when no config is supplied.
- Added DigitalOcean `api.swfi.com` DNS cutover controller: `npm run brd:api-dns:cutover`. It preflights the `swfi.com` A record, stores rollback data, patches only when `SWFIPN_API_DNS_APPLY=1`, and reruns the production API gate after cutover.
- Added Phase 2 runtime preflight: `npm run runtime:phase2:preflight:public`. It proves whether target-runtime SendGrid and SWFI session bridge config exists without sending email, minting sessions, changing DNS, or exposing secret values.
- Added Phase 2 closure packet generator: `npm run phase2:closure-packet`. It turns current receipts into an operator-ready closure packet for DNS, SendGrid, and SWFI session bridge with commands, rollback, guardrails, and pass conditions.
- Added Alerts UI test-delivery action backed by `/api/v1/alerts/{id}/deliveries/test`.
- Added acceptance-matrix coverage for in-app and webhook alert delivery receipts, with email delivery and SendGrid onboarding explicitly unclaimed until separately implemented and gated.

### Changed
- Updated Admin deferred scope so organizations/users/roles/content workflow is receipt-backed on the accepted public host; real SWFI auth and SendGrid remain unclaimed.
- Updated Saved Searches BRD matrix coverage so linked in-app alert delivery is receipt-backed current scope, not deferred scope.
- Updated Alerts backend/API acceptance logic to require webhook and in-app delivery receipts instead of the older fail-closed webhook placeholder.
- Updated alert/admin email handling so configured SendGrid delivery can write accepted email receipts, while missing provider configuration remains blocked/unclaimed.
- Updated the static edge so a verified SWFI-signed assertion can create an HTTP-only `/swficc` session and let protected user APIs receive edge-injected user/backend authorization headers without exposing backend tokens in the browser.
- Updated DigitalOcean runbook with the exact SWFI session bridge and SendGrid variables required before their public gates can be claimed.
- Updated BRD gap/audit docs and acceptance-lock evidence rows so deferred scope now says email/SendGrid, real SWFI auth/session integration, and `api.swfi.com` DNS cutover, not Admin Governance, Saved Searches linked in-app delivery, or in-app/webhook alert delivery.

### Verified
- Local and public Admin Governance BRD gates passed: protected org/user/content APIs, role denial checks, UI create flows, no secret/hash leakage, no SendGrid or real SWFI auth claim.
- Backend SendGrid provider tests passed for configured alert email delivery and configured admin welcome email delivery; public SendGrid email gate is deployed and blocked only because the acceptance runtime has no SendGrid provider configuration.
- Local SWFI session bridge mechanics gate passed; public target remains blocked until the bridge route/secret/sign-in return assertion are configured.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260627T003833Z` to `swfipn.activemirror.ai`; runtime staleness passed against asset version `20260627T003833Z`, and SendGrid email gate returned blocked with `sendgrid_not_configured_on_target_runtime`.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260627T001836Z` to `swfipn.activemirror.ai`; public Admin Governance gate, Admin API Product Console UI gate, BRD Phase 2 matrix, runtime staleness, share gate, acceptance lock, and loop-collapse detector passed against asset version `20260627T001836Z`.
- Public BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`: 24 total requirements, 23 pass, 0 fail, 0 stale, 1 explicit deferred P2 bucket.

## 2026-06-26

### Added
- Added BRD v1.3 dashboard landing surface matching Figure 1: SWFI top nav, Discover search strip, news feed tabs, right rail, Newest Data table, Top 10 panel, and Global Search modal.
- Added source-backed homepage packets for Entities and People via `/api/source-data/search/v1`.
- Added repeatable BRD dashboard receipt gate: `npm run brd:dashboard:gate` and `npm run brd:dashboard:gate:public`.
- Added the full-universe backend record mapping gate: `npm run universe:map:public`.
- Added per-family NDJSON evidence under `output/full-universe/` and latest summary receipt at `output/swfipn-full-universe-mapping-latest.json`.
- Documented the full-universe gate, scope, output contract, and latest blockers in `docs/swfipn-full-universe-mapping-gate.md`.
- Added reports enumeration/detail support to the BRD scope, including `/swficc/reports/detail/?key=...` and full-universe report mapping.
- Added People profile BRD gate: `npm run brd:people-profile:gate:public`.
- Added section visualization BRD gate: `npm run brd:section-visualization:gate:public`.
- Added deterministic Data/Visualization switches, chart filter links, Export CSV, and Export PNG controls across the current list-page scope.
- Added BRD Entities Aggregates support at `/swficc/profiles/aggregates/` and `/swficc/entities/aggregates/`, backed by `/api/entities/aggregates/v1` with server-side historical AUM smoothing modes and raw `entitiesAUM` preservation.
- Added aggregate BRD gate: `npm run brd:aggregates:gate:public`.
- Added API product spine: public docs at `/docs`, versioned `/v1/*` JSON routes, `X-API-Key` auth, limit/offset pagination, product-safe field whitelisting, and per-key rate-limit enforcement in the backend.
- Added API product BRD gate: `npm run brd:api-product:gate:public`.
- Added Admin API Product Console at `/swficc/admin/` for protected API-key lifecycle operations.
- Added Admin API Product Console UI gate: `npm run brd:admin-api-ui:gate:public`.
- Added Saved Searches backend/API acceptance gate: `npm run brd:saved-searches:gate:public`.
- Added Saved Searches page UI API-client gate: `npm run brd:saved-searches-ui:gate:public`.
- Added Alerts backend/API acceptance gate: `npm run brd:alerts:gate:public`.
- Added Alerts page UI API-client gate: `npm run brd:alerts-ui:gate:public`.

### Verified
- Local Admin API Product Console UI gate passed: `/swficc/admin/` loads product API key metadata, creates a managed key, displays the one-time secret to the operator, revokes the created key, and writes no generated secret or key hash to the receipt.
- Local BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`: 21 pass, 0 fail, 0 stale, 0 non-deferred gaps, 1 explicit deferred P2 bucket.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T230725Z` to `swfipn.activemirror.ai`; public Admin API Product Console UI gate, API-key lifecycle gate, BRD Phase 2 matrix, runtime staleness, share gate, and acceptance lock passed against asset version `20260626T230725Z`.
- Local Alerts page UI gate passed: `/swficc/alerts/` loads the source-backed alerts feed, then the browser creates, disables, loads history for, and deletes an alert rule through `/api/v1/alerts` without writing access tokens to receipts or claiming outbound delivery.
- Local Saved Searches page UI gate passed: `/swficc/search/?q=Infrastructure` loads the protected workspace, then the browser creates, updates with alert confirmation, reruns current results for, and deletes a saved search through `/api/v1/saved-searches` without writing access tokens or fact-row payloads to receipts.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T223049Z` to `swfipn.activemirror.ai`; public Saved Searches page UI gate, BRD Phase 2 matrix, runtime staleness, and acceptance lock passed against asset version `20260626T223049Z`.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T221511Z` to `swfipn.activemirror.ai`; public Alerts page UI gate, BRD Phase 2 matrix, runtime staleness, and acceptance lock passed against asset version `20260626T221511Z`.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T215540Z` to `swfipn.activemirror.ai`.
- Public Alerts backend/API gate passed: unauthenticated write blocked, per-user isolation, alert validation, plain-English preview, 90-day history endpoint, the then-current webhook fail-closed placeholder, and no secret/fact-row payload leakage in the receipt. Superseded by the 2026-06-27 receipt-backed webhook delivery gate above.
- Public API product, API key lifecycle, and Saved Searches gates still pass after the Alerts backend/proxy update.
- Public runtime staleness gate passed for release `/opt/swfipn-acceptance/releases/20260626T215540Z` with asset version `20260626T215540Z`.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T213928Z` to `swfipn.activemirror.ai`.
- Public Saved Searches backend/API gate passed: unauthenticated write blocked, per-user isolation, alert-update confirmation, delete-with-linked-alert behavior, current-results rerun, and no secret/fact-row payload leakage in the receipt.
- Public API key lifecycle and API product gates still pass after the protected proxy-route update.
- Public runtime staleness gate passed for release `/opt/swfipn-acceptance/releases/20260626T213928Z` with asset version `20260626T213928Z`.
- Public BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`: 17 pass, 0 fail, 0 stale, 0 non-deferred gaps, 1 explicit deferred P2 bucket.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T184711Z` to `swfipn.activemirror.ai`.
- Public API product gate passed: docs, unauthenticated 401, keyed Entities/People/Transactions/Compass/Reports lists, keyed Entities Aggregates, whitelisted response fields, and no API product leakage failures.
- Public BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`: 15 pass, 0 fail, 0 stale, 0 non-deferred gaps, 1 explicit deferred P2 bucket.
- Public runtime staleness gate passed for release `/opt/swfipn-acceptance/releases/20260626T184711Z` with asset version `20260626T184711Z`.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T181425Z` to `swfipn.activemirror.ai`.
- Public BRD aggregate gate passed with 56 source-backed points, 56 raw points, Graph/Data view, smoothing methods, CSV/PNG exports, no console failures, and no internal leakage.
- Public BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`: 14 pass, 0 fail, 0 stale, 0 non-deferred gaps, 1 explicit deferred P2 bucket.
- Deployed current BRD validation release `/opt/swfipn-acceptance/releases/20260626T173828Z` to `swfipn.activemirror.ai`.
- Public BRD Phase 2 matrix returned `pass_with_deferred_scope` and verdict `go_for_current_scope`.
- Public People profile BRD gate passed with local profile actions, section navigation, vCard export, source links, and no internal leakage.
- Public section visualization BRD gate passed across 6 routes with 79 chart filter links, 6 CSV exports, 6 PNG exports, and no console failures.
- Public Compass/RFP BRD gate passed with `Showing 25 of 4,883`, charts, filters, and no leakage.
- Public global search BRD gate passed on warm run: autocomplete `6ms`, results page `755ms`.
- Public BRD performance gate passed: dashboard first usable render `880ms`, data `26ms`.
- Public full-universe gate run `20260626171025` mapped `932,047 / 932,047` backend records with `0` failures across entities, people, transactions, compass, news, and reports.
- Public detail pages now render locally when `SWFIPN_REQUIRE_RECORD_AUTH` is not enabled, instead of being swallowed by SWFI sign-in redirects.
- Deployed BRD dashboard release `/opt/swfipn-acceptance/releases/20260626T140155Z` to `swfipn.activemirror.ai`.
- Public BRD dashboard gate passed with caveats: `output/swfipn-brd-dashboard-receipt-latest.json`.
- Public source-truth gate passed: `output/swfipn-source-truth-gate-latest.json`.
- Public visible-link escape gate passed after allowing only the BRD-required `gwc.events` host.
- Public link-mapping/leakage gate passed across 26 routes with 0 failures.
- Deferred P2 caveat as of this release: several admin, delivery, saved-search, email, DNS, and production API-key lifecycle items were not claimed complete until separate receipts existed. Superseded by the 2026-06-27 receipts for alert delivery, Saved Searches linked in-app alert delivery, API-key lifecycle UI, and Admin Governance; remaining deferred scope is email/SendGrid onboarding, real SWFI auth/session integration, and `api.swfi.com` DNS cutover.

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
