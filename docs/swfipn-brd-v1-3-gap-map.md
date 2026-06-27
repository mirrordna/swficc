# SWFIPN BRD v1.3 Gap Map

Source document: `/Users/mirror-pro/Downloads/SWFI_BRD_v1_3_june2026.docx`

Extracted text: `output/SWFI_BRD_v1_3_june2026.extracted.txt`

Date: 2026-06-26

## Executive Read

Current verdict: `go_for_current_scope`.

The public `/swficc` dashboard/terminal scope is deployed and receipt-backed for validation. The latest BRD Phase 2 matrix is `pass_with_deferred_scope`: 23 pass, 0 fail, 0 stale, 0 non-deferred gaps, and 1 explicit deferred P2 bucket across 24 tracked requirements.

This does not claim full BRD Phase 2 productization. Admin API-key lifecycle UI, Admin Governance, Saved Searches backend/API, Saved Searches linked in-app alert delivery receipts, Saved Searches page UI API client, Alerts backend/API, Alerts page UI API client, alert in-app/webhook delivery receipts, and local SWFI session bridge mechanics are implemented and gated. Email delivery/SendGrid onboarding, target-runtime SWFI session bridge configuration, and `api.swfi.com` DNS cutover remain deferred until their public target receipts pass.

## Current Receipts

| Area | Status | Receipt |
| --- | --- | --- |
| Full public acceptance stack | `pass` | `output/swfipn-acceptance-lock-latest.json` |
| Public sendability | `pass`, `sendable: true` | `output/swfipn-share-gate-latest.json` |
| Phase 2 matrix | `pass_with_deferred_scope` | `output/swfipn-brd-phase2-acceptance-latest.json` |
| Dashboard Figure 1 structure | `pass_with_caveats` | `output/swfipn-brd-dashboard-receipt-latest.json` |
| Source-truth / no fake values | `pass` | `output/swfipn-source-truth-gate-latest.json` |
| Global search | `pass` | `output/swfipn-global-search-brd-gate-latest.json` |
| List pages | `pass` | `output/swfipn-list-data-proof-latest.json` |
| Table controls | `pass` | `output/swfipn-table-controls-proof-latest.json` |
| Route and link parity | `pass` | `output/swfipn-link-mapping-leakage-gate-latest.json` |
| Compass / RFPs | `pass` | `output/swfipn-compass-brd-gate-latest.json` |
| People profiles | `pass` | `output/swfipn-people-profile-brd-gate-latest.json` |
| Section visualizations | `pass` | `output/swfipn-section-visualization-brd-gate-latest.json` |
| Backend contracts | `pass` | `output/swfipn-phase2-backend-acceptance-latest.json` |
| Full-universe mapping | `pass` | `output/swfipn-full-universe-mapping-latest.json` |
| Performance | `pass` | `output/swfipn-brd-performance-gate-latest.json` |
| Entities Aggregates | `pass` | `output/swfipn-aggregates-brd-gate-latest.json` |
| API Product Spine | `pass` | `output/swfipn-api-product-gate-latest.json` |
| API Key Lifecycle | `pass` | `output/swfipn-api-key-lifecycle-latest.json` |
| Admin API Product Console UI | `pass` | `output/swfipn-admin-api-ui-brd-gate-latest.json` |
| Admin Governance | `pass` | `output/swfipn-admin-governance-brd-gate-latest.json` |
| Saved Searches backend/API + linked alert delivery | `pass` | `output/swfipn-saved-searches-brd-gate-latest.json` |
| Saved Searches page UI API client + linked alert delivery test | `pass` | `output/swfipn-saved-searches-ui-brd-gate-latest.json` |
| Alerts backend/API | `pass` | `output/swfipn-alerts-brd-gate-latest.json` |
| Alerts page UI API client | `pass` | `output/swfipn-alerts-ui-brd-gate-latest.json` |
| Alert delivery receipts | `pass` | `output/swfipn-alert-delivery-brd-gate-latest.json` |
| SWFI session bridge mechanics | `blocked` on public runtime; local contract passes | `output/swfipn-swfi-session-bridge-brd-gate-latest.json` |

## Current Status By BRD Area

| BRD Area | Current SWFIPN Status | Acceptance Impact |
| --- | --- | --- |
| Navigation | Figure 1 dashboard nav and current terminal routes are deployed. Account/Alerts/Terminology product workflows are deferred unless separately scoped. | Pass for current scope |
| Dashboard layout | Public dashboard gate passes against the BRD Figure 1 terminal/discovery structure. | Pass with caveats |
| Dashboard data | Source-backed packets are deployed and internal labels are stripped from user-facing UI. | Pass |
| Global search | Modal/search workflow and performance receipt are current. | Pass |
| Compass / RFPs | Data and visualization views, filters, charts, counts, and leakage checks are receipt-backed. | Pass |
| People profiles | Profile detail layout/actions are receipt-backed where source data permits. | Pass |
| Visualizations | Current list sections have Data/Visualization modes, chart filter links, CSV export, PNG export, responsive checks, and meaningful states. | Pass |
| Reports | Reports list/detail and full-universe mapping are receipt-backed. | Pass |
| Transactions | Current transaction/deal list and visualization scope is covered by list/table/visualization gates. | Pass for current scope |
| Entities | Entity list controls, route parity, and aggregate charts are receipt-backed. | Pass |
| News / Intelligence | Current news/research route and full-universe mapping are receipt-backed. | Pass for current scope |
| Aggregates | Historical AUM charts, entity class and region tabs, smoothing controls, Graph/Data view, CSV export, and PNG export are receipt-backed. | Pass |
| Performance | Current BRD performance gate passes dashboard TTI and data-packet targets. | Pass |
| Admin | API-key lifecycle UI and Admin Governance for organizations, users, role permissions, validation, and content workflow are receipt-backed on the accepted public host. | Pass for API-key console and Admin Governance |
| Alerts | Backend/API rule storage, per-user isolation, validation, plain-English preview, 90-day history endpoint, page UI API client, and in-app/webhook delivery receipts are receipt-backed. Email delivery remains deferred until SendGrid onboarding. | Pass for backend/API, UI API client, and in-app/webhook receipts; deferred P2 for email delivery |
| Saved Searches | Backend/API CRUD endpoints, per-user isolation, alert-update confirmation, delete-with-linked-alert behavior, current-results rerun, linked in-app alert delivery receipts, and page UI API client are receipt-backed. Local SWFI session bridge mechanics are implemented; target-runtime SWFI assertion configuration remains deferred. | Pass for backend/API, UI API client, linked in-app delivery receipts, and local bridge mechanics; deferred P2 for target auth integration |
| API Product Spine | Public docs, versioned `/v1/*` JSON, `X-API-Key` auth, list pagination/filter smoke, product-safe field whitelisting, keyed aggregate data, and documented rate limit are receipt-backed. | Pass |
| API Product DNS | `api.swfi.com` DNS cutover. API-key lifecycle passes on the accepted public host. | Deferred P2 for DNS only |
| SendGrid | Welcome/onboarding email workflows. | Deferred P2 |
| SWFI Session Bridge | SWFI-origin signed assertion callback, protected route continuity, and browser-safe backend identity forwarding. | Local contract pass; public target blocked until SWFI assertion secret/return path are configured |

## Full-Universe Data Impact

Latest hardened run:

- run id: `20260626171025`
- status: `pass`
- rows scanned/written: `932,047`
- rows passed: `932,047`
- rows failed: `0`
- included families: entities, people, transactions, compass, news, and reports

Receipt:

```bash
output/swfipn-full-universe-mapping-latest.json
```

## Entities Aggregates Slice

The Aggregates requirement is now implemented and gated:

- public page: `https://swfipn.activemirror.ai/swficc/profiles/aggregates/`
- backend endpoint: `/api/entities/aggregates/v1`
- latest public gate: `output/swfipn-aggregates-brd-gate-latest.json`
- result: `pass`
- source collections: `entities`, `entitiesAUM`
- smoothing modes: `linear`, `forward_fill`, `rolling_3y`, `none`
- raw source rows are not modified

Latest public aggregate gate summary:

- points: `56`
- raw points: `56`
- estimated points: `0`
- raw gaps in `none` view: `0`
- chart present: yes
- CSV export: yes
- PNG export: yes
- internal leaks: none
- console errors: none

The zero estimated-point count is correct for the tested live source slice because the source has a contiguous yearly series; the gate only requires estimated markers when raw source gaps exist.

## API Product Spine Slice

The API product spine is now implemented and gated:

- public docs: `https://swfipn.activemirror.ai/docs`
- product base URL documented by API: `https://api.swfi.com`
- versioned routes: `/v1/entities`, `/v1/people`, `/v1/transactions`, `/v1/compass`, `/v1/reports`, `/v1/entities/aggregates`
- authentication: `X-API-Key`
- latest public gate: `output/swfipn-api-product-gate-latest.json`
- API-key lifecycle gate: `output/swfipn-api-key-lifecycle-latest.json` — `pass` on the accepted public host
- result: `pass`
- DNS/key lifecycle gate: `output/swfipn-api-dns-key-lifecycle-latest.json` — `blocked` on production host
- API vhost readiness on the accepted DO host: `pass`
- unauthenticated list request: `401`
- keyed list checks: entities, people, transactions, compass, reports all pass
- keyed aggregate check: pass
- response field boundary: product-safe whitelist, no internal receipt fields
- rate limit: backend unit receipt covers `429` with `Retry-After`; public docs expose the rate-limit contract
- API-key lifecycle: create, one-time secret return, managed-key use, metadata list without secret/hash leakage, revoke, and rejected-after-revoke are receipt-backed on `https://swfipn.activemirror.ai`

This is not a claim that DNS is already cut over for `api.swfi.com`. The DNS/key lifecycle gate must pass on `https://api.swfi.com` before that host is claimed as live.

Current DNS/key lifecycle receipt: acceptance API control passes and the DO Caddy vhost for `api.swfi.com` is prepared. Public DNS still resolves `api.swfi.com` to `67.207.93.157`, `https://api.swfi.com/docs` returns `404` from nginx, and keyed production-host checks do not reach the accepted API surface. The expected cutover target remains `161.35.56.218`.

## Admin API Product Console Slice

The Admin API Product Console UI is now implemented and gated on the accepted public host:

- public page: `https://swfipn.activemirror.ai/swficc/admin/`
- latest gate: `output/swfipn-admin-api-ui-brd-gate-latest.json`
- tested UI flow: load product API keys, create a managed key, display the one-time secret to the operator, revoke the created key
- API path exercised by browser: `/v1/admin/api-keys`
- receipt contains no generated API key secret, service token, or key hash
- real SWFI auth/session integration is not claimed
- organizations/users/roles/content admin is covered by the Admin Governance gate below

## SWFI Session Bridge Slice

The real-auth bridge is now a concrete implementation/gate instead of an undefined deferred item:

- edge callback: `/swficc/auth/bridge/`
- local contract gate: `output/swfipn-swfi-session-bridge-brd-gate-latest.json`
- local proof covers invalid assertion rejection, expired assertion rejection, valid SWFI-style signed assertion acceptance, HTTP-only session creation, protected `/swficc` detail route continuity, and backend user API calls where the edge injects backend authorization/user headers without exposing the backend token to the browser
- current public target status: blocked until the route is deployed and configured with SWFI session bridge secret, issuer/audience, sign-in return path, and SWFI signed assertion proof
- real SWFI auth/session integration claimed: no

## Admin Governance Slice

The Admin Governance contract is implemented and gated on the accepted public host:

- public page: `https://swfipn.activemirror.ai/swficc/admin/`
- backend endpoints: `/v1/admin/permissions`, `/v1/admin/organizations`, `/v1/admin/users`, `/v1/admin/content-items`
- latest gate: `output/swfipn-admin-governance-brd-gate-latest.json`
- tested API flow: unauthenticated write blocked, Viewer write blocked, Super Admin creates organization, Admin creates user, Admin delete user blocked, Editor creates content, Viewer content write blocked
- tested UI flow: load Admin Governance, create organization, create user, create content workflow draft
- one-time product API key is generated for users at API-enabled organizations
- receipts do not write the generated key, service token, key hashes, or temporary passwords
- SendGrid onboarding and welcome email delivery are not claimed
- real SWFI auth/session integration is not claimed on the public target runtime; local bridge mechanics are separately gated

## Saved Searches Backend/API Slice

The Saved Searches backend/API contract is now implemented and gated on the accepted public host:

- endpoints: `GET /api/v1/saved-searches`, `POST /api/v1/saved-searches`, `PATCH /api/v1/saved-searches/{id}`, `DELETE /api/v1/saved-searches/{id}`, `GET /api/v1/saved-searches/{id}/results`, `POST /api/v1/saved-searches/{id}/alert-deliveries/test`
- latest public gate: `output/swfipn-saved-searches-brd-gate-latest.json`
- result: `pass`
- source of truth: `swfi2_product_contract`
- per-user isolation: yes
- unauthenticated create: `401`
- alert-enabled filter edits require explicit confirmation: yes
- delete disables the linked alert: yes
- rerun reads current approved backend data instead of persisting fact-row snapshots: yes
- linked in-app alert delivery receipt: yes
- email delivery claimed: no
- SendGrid onboarding claimed: no
- receipt contains no service token, generated secret, key hash, or fact-row payload fields

This is not a claim that email delivery, SendGrid onboarding, or public target SWFI auth/session integration is complete.

## Saved Searches Page UI API Client Slice

The Search page now includes a receipt-backed Saved Search workspace:

- public page: `https://swfipn.activemirror.ai/swficc/search/?q=Infrastructure`
- latest gate: `output/swfipn-saved-searches-ui-brd-gate-latest.json`
- tested UI flow: load saved searches, create saved search, update with alert confirmation, test linked in-app alert delivery, rerun current results, delete saved search
- API path exercised by browser: `/api/v1/saved-searches`
- no access token is embedded in frontend source or written to the receipt
- no fact-row payloads are persisted in the receipt
- linked in-app alert delivery test writes a stored receipt
- email delivery and SendGrid onboarding are not claimed
- public target SWFI session bridge configuration remains deferred

## Alerts Backend/API Slice

The Alerts backend/API contract is now implemented and gated on the accepted public host:

- endpoints: `GET /api/v1/alerts`, `POST /api/v1/alerts`, `PATCH /api/v1/alerts/{id}`, `DELETE /api/v1/alerts/{id}`, `GET /api/v1/alerts/history`
- latest public gate: `output/swfipn-alerts-brd-gate-latest.json`
- result: `pass`
- source of truth: `swfi2_product_contract`
- per-user isolation: yes
- unauthenticated create: `401`
- alert types validated: transaction, compass RFP, news, entity AUM, people
- delivery channels validated: in-app, email, webhook
- invalid webhook URL rejected: yes
- webhook delivery receipt written by delivery worker: yes
- in-app delivery receipt written by delivery worker: yes
- email delivery path is implemented through SendGrid, but the accepted public runtime blocks/unclaims it until SendGrid provider configuration exists
- Entity AUM alerts require `entity_ids`: yes
- plain-English preview returned for saved rules: yes
- history endpoint enforces 90-day retention metadata: yes
- receipt contains no service token, generated secret, key hash, or fact-row payload fields

## Alerts Page UI API Client Slice

The Alerts page now includes a receipt-backed rule-management UI:

- public page: `https://swfipn.activemirror.ai/swficc/alerts/`
- latest gate: `output/swfipn-alerts-ui-brd-gate-latest.json`
- tested UI flow: load saved rules, create alert, test delivery, disable alert, load 90-day history, delete alert
- API path exercised by browser: `/api/v1/alerts`
- no access token is embedded in frontend source or written to the receipt
- test delivery is receipt-backed; SendGrid email delivery remains blocked on target runtime provider configuration
- public target SWFI session bridge configuration remains deferred

## Alert Delivery Receipt Slice

The alert delivery receipt contract is now implemented for in-app, webhook, and configured SendGrid email channels:

- endpoint: `POST /api/v1/alerts/{id}/deliveries/test`
- webhook sink: `POST /api/v1/alerts/webhook-test-sink`
- latest gate: `output/swfipn-alert-delivery-brd-gate-latest.json`
- tested flow: create webhook/in-app alert, write validation receipts, trigger test delivery, verify 90-day history, create email-only alert, and prove email is blocked/unclaimed when SendGrid is not configured
- SendGrid email gate: `output/swfipn-sendgrid-email-brd-gate-latest.json`
- current public SendGrid status: blocked on missing target runtime provider configuration
- no generated secrets, service tokens, webhook response bodies, or fact-row payloads are written to the receipt
- public target SWFI session bridge configuration remains deferred

This is not a claim that email delivery or SendGrid onboarding is complete on the accepted public runtime.

## Remaining Scope

Only the explicit deferred P2 productization bucket remains outside the current validation claim:

- Configure SendGrid key/from-address on the accepted target runtime and rerun the SendGrid email gate to pass
- Configure the SWFI session bridge secret/issuer/audience/sign-in return assertion on the accepted target runtime and rerun the SWFI session bridge gate to pass
- `api.swfi.com` DNS cutover

## Plain-English Verdict

The current BRD dashboard/terminal scope is deployed, mapped, source-backed, and ready for validation with receipts. The latest BRD Phase 2 matrix passes with 23 accepted requirements, 0 failures, and 1 explicit deferred P2 bucket across 24 tracked requirements.

Do not say full BRD Phase 2 productization is complete until the deferred P2 areas above are implemented and gated.
