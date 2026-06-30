# SWFIPN BRD v1.3 Current Completion Audit

Source BRD: `/Users/mirror-pro/Downloads/SWFI_BRD_v1_3_june2026.docx`

Public URL: `https://swfipn.activemirror.ai/swficc/`

Deployed release: `/opt/swfipn-acceptance/releases/20260630T095954Z`

Current asset version: `20260630T0954Z-redis-cache`

Audit timestamp: 2026-06-30 UTC receipts.

## Topline

Current `/swficc` deployment is live on DO and has receipt-backed search, Redis, and CDN/static asset checks.

Full BRD Phase 2 productization is not complete.

Full universe parity is `UNPROVEN` until the BRD contract truth gate passes. Mapping coverage alone is not a parity claim.

Current full-BRD infra blocker rollup: `3 open / 2 closed`.

## Current Stack Result

| Check | Result | Evidence |
| --- | --- | --- |
| Full acceptance stack | `go_with_caveat`, 0 blockers | `output/swfipn-acceptance-lock-latest.json` |
| Share/sendability | `pass`, `sendable: true` | `output/swfipn-share-gate-latest.json` |
| BRD Phase 2 matrix | `pass_with_deferred_scope`, `go_for_current_scope` | `output/swfipn-brd-phase2-acceptance-latest.json` |
| Runtime staleness | `pass` | `output/swfipn-runtime-staleness-gate-latest.json` |
| API product spine | `pass` on acceptance host | `output/swfipn-api-product-gate-latest.json` |
| API key lifecycle | `pass` on acceptance host | `output/swfipn-api-key-lifecycle-latest.json` |
| Admin API Product Console UI | `pass` on acceptance host | `output/swfipn-admin-api-ui-brd-gate-latest.json` |
| Admin Governance | `pass` on acceptance host | `output/swfipn-admin-governance-brd-gate-latest.json` |
| Saved Searches backend/API + linked alert delivery | `pass` on acceptance host | `output/swfipn-saved-searches-brd-gate-latest.json` |
| Saved Searches page UI API client + linked alert delivery test | `pass` on acceptance host | `output/swfipn-saved-searches-ui-brd-gate-latest.json` |
| Alerts backend/API | `pass` on acceptance host | `output/swfipn-alerts-brd-gate-latest.json` |
| Alerts page UI API client | `pass` on acceptance host | `output/swfipn-alerts-ui-brd-gate-latest.json` |
| Alert delivery receipts | `pass` on acceptance host | `output/swfipn-alert-delivery-brd-gate-latest.json` |
| SWFI session bridge mechanics | Local contract pass; public runtime blocked until bridge route/secret/return assertion are configured | `output/swfipn-swfi-session-bridge-brd-gate-latest.json` |
| Production API DNS cutover | `blocked`; API vhost prepared on DO | `output/swfipn-api-dns-key-lifecycle-latest.json` |
| Full universe parity | `UNPROVEN` | `output/swfipn-brd-contract-truth-gate-latest.json` |
| Search SLA repeated public gate | `pass`, 5/5 | `output/swfipn-search-gate-repeated-latest.json` |
| Redis cache runtime gate | `pass`, runtime Redis PONG proven | `output/swfipn-redis-cache-gate-latest.json` |
| CDN static asset gate | `pass` | `output/swfipn-cdn-static-assets-gate-latest.json` |
| BRD infra blocker rollup | `open_external_inputs_required`, 3 open / 2 closed | `output/swfipn-brd-open-infra-blockers-latest.json` |

## BRD Areas

| BRD Area | Current Result | Evidence |
| --- | --- | --- |
| Dashboard navigation and SWFI-style shell | Pass | `output/swfipn-brd-dashboard-receipt-latest.json` |
| Public dashboard access | Pass | `output/swfipn-acceptance-criteria-gate-latest.json` |
| No internal user-facing leakage | Pass | `output/swfipn-link-mapping-leakage-gate-latest.json`, `output/swfipn-visible-link-escape-gate-latest.json` |
| Dashboard data source truth | Pass | `output/swfipn-source-truth-gate-latest.json` |
| Global search modal/workflow | Pass | `output/swfipn-global-search-brd-gate-latest.json` |
| Entity/institution lists and detail navigation | Pass for current scope | `output/swfipn-list-data-proof-latest.json`, `output/swfipn-link-mapping-leakage-gate-latest.json` |
| People list/profile workflow | Pass | `output/swfipn-people-profile-brd-gate-latest.json` |
| Transactions/deals workflow | Pass for current scope | `output/swfipn-list-data-proof-latest.json`, `output/swfipn-section-visualization-brd-gate-latest.json` |
| Compass/RFP workflow | Pass | `output/swfipn-compass-brd-gate-latest.json` |
| Reports/news/intelligence workflow | Pass for current scope; full-universe parity unproven | `output/swfipn-full-universe-mapping-latest.json`, `output/swfipn-list-data-proof-latest.json`, `output/swfipn-brd-contract-truth-gate-latest.json` |
| Visualizations, chart exports, responsive checks | Pass | `output/swfipn-section-visualization-brd-gate-latest.json` |
| Entities aggregates/AUM charts | Pass | `output/swfipn-aggregates-brd-gate-latest.json` |
| Backend contract and list APIs | Pass | `output/swfipn-phase2-backend-acceptance-latest.json` |
| API product spine on acceptance host | Pass | `output/swfipn-api-product-gate-latest.json` |
| API key lifecycle on acceptance host | Pass | `output/swfipn-api-key-lifecycle-latest.json` |
| Admin API Product Console UI on acceptance host | Pass | `output/swfipn-admin-api-ui-brd-gate-latest.json` |
| Admin Governance organizations/users/roles/content workflows | Pass | `output/swfipn-admin-governance-brd-gate-latest.json` |
| Saved Searches backend/API and linked alert delivery on acceptance host | Pass | `output/swfipn-saved-searches-brd-gate-latest.json` |
| Saved Searches page UI API client and linked alert delivery test on acceptance host | Pass | `output/swfipn-saved-searches-ui-brd-gate-latest.json` |
| Alerts backend/API on acceptance host | Pass | `output/swfipn-alerts-brd-gate-latest.json` |
| Alerts page UI API client on acceptance host | Pass | `output/swfipn-alerts-ui-brd-gate-latest.json` |
| Alert in-app/webhook delivery receipts on acceptance host | Pass | `output/swfipn-alert-delivery-brd-gate-latest.json` |
| Search performance SLA | Pass | `output/swfipn-search-gate-repeated-latest.json` |
| Redis caching for dashboard KPI/search/aggregates | Pass | `output/swfipn-redis-cache-gate-latest.json` |
| CDN static asset caching | Pass | `output/swfipn-cdn-static-assets-gate-latest.json` |
| SendGrid email delivery on acceptance host | Blocked: provider not configured on target runtime | `output/swfipn-sendgrid-email-brd-gate-latest.json` |
| Real SWFI auth/session bridge | Code/gate implemented; target runtime blocked until SWFI signed assertions and bridge return path are configured | `output/swfipn-swfi-session-bridge-brd-gate-latest.json` |
| `api.swfi.com` production cutover | Blocked | `output/swfipn-api-dns-key-lifecycle-latest.json` |
| Email delivery / SendGrid onboarding | Code/gate deployed; blocked until SendGrid key/from-address is configured and the SendGrid gate passes | `output/swfipn-sendgrid-email-brd-gate-latest.json` |
| Saved Searches real SWFI auth/session integration | Deferred P2; local bridge contract now receipt-backed | `output/swfipn-swfi-session-bridge-brd-gate-latest.json` |

## Blocking Items For Full BRD Phase 2

- Mongo indexes are script/dry-run verified; apply reached Atlas but failed with createIndexes authorization denied.
- SendGrid email delivery code and gate are deployed; target runtime is blocked on missing SendGrid provider configuration.
- CDN/static asset caching and zero high/critical npm audit are proven, but a current successful remote GitHub Actions run receipt is missing.

## Alerts Backend/API Progress

The accepted public host now passes the Alerts backend/API gate:

- BRD alert-rule endpoints exist under `/api/v1/alerts`.
- Requests require service-token caller authorization and a user identity header.
- Alert rules are isolated per user.
- Alert type, delivery channel, frequency, criteria, and webhook URL validation are enforced.
- Plain-English rule previews are returned for saved rules.
- Alert History endpoint returns 90-day retention metadata.
- In-app and webhook delivery receipts are written when delivery is tested or triggered.
- Email delivery path is implemented through SendGrid, but the accepted public runtime blocks/unclaims email until SendGrid provider configuration exists.
- The receipt does not expose service tokens, generated secrets, key hashes, or fact-row payload fields.

## Alerts Page UI Progress

The accepted public host now passes the Alerts page UI API-client gate:

- `/swficc/alerts/` contains the source-backed alert feed and protected alert-rule management panel.
- Browser workflow loads saved rules, creates an alert, tests delivery, disables it, loads 90-day history, and deletes the alert.
- The UI calls the protected `/api/v1/alerts` API; no access token is embedded in frontend source or written to receipts.
- The UI does not expose backend fact-row payload fields or claim email delivery.

## Alert Delivery Receipt Progress

The alert delivery receipt slice is implemented for in-app and webhook channels:

- `POST /api/v1/alerts/{id}/deliveries/test` writes stored delivery receipts.
- `POST /api/v1/alerts/webhook-test-sink` provides a deterministic self-hosted webhook target for public proof.
- Webhook and in-app validation/test delivery receipts pass in `output/swfipn-alert-delivery-brd-gate-latest.json`.
- Email-only delivery returns a blocked receipt and keeps `email_delivery_claimed: false` on the accepted public runtime until SendGrid provider configuration exists.
- Configured SendGrid delivery is covered by backend tests and the public SendGrid gate: `output/swfipn-sendgrid-email-brd-gate-latest.json`.
- The receipt must not expose service tokens, generated secrets, webhook response bodies, or fact-row payload fields.

The remaining Alerts scope is configuring SendGrid on the target runtime and completing real SWFI auth/session bridge configuration.

## Saved Searches Backend/API Progress

The accepted public host now passes the Saved Searches backend/API gate:

- BRD CRUD endpoints exist under `/api/v1/saved-searches`.
- Requests require service-token caller authorization and a user identity header.
- Saved searches are isolated per user.
- Alert-enabled filter edits require explicit confirmation.
- Deleting a saved search disables the linked alert.
- Result reruns read current approved backend data instead of storing fact-row snapshots.
- Linked in-app alert delivery tests write stored delivery receipts after checking current source-backed results.
- Email delivery and SendGrid onboarding remain unclaimed.
- The receipt does not expose service tokens, generated secrets, key hashes, or fact-row payload fields.

The remaining Saved Searches scope is target-runtime SWFI session bridge configuration. Local bridge mechanics are covered by `output/swfipn-swfi-session-bridge-brd-gate-latest.json`.

## Saved Searches Page UI Progress

The accepted public host now passes the Saved Searches page UI API-client gate:

- `/swficc/search/?q=Infrastructure` contains the protected Saved Search workspace.
- Browser workflow loads saved searches, creates a saved search, updates it with alert confirmation, tests linked in-app alert delivery, reruns current source-backed results, and deletes the saved search.
- The UI calls the protected `/api/v1/saved-searches` API; no access token is embedded in frontend source or written to receipts.
- The UI does not persist backend fact-row payload fields or claim real SWFI auth/session integration.
- The UI exposes the linked alert delivery test only for alert-enabled saved searches.

The remaining Saved Searches scope is target-runtime SWFI session bridge configuration.

## API Cutover Progress

The accepted DO host is now prepared to serve the API hostname:

- Expected target IP: `161.35.56.218`.
- Caddy vhost for `api.swfi.com` is deployed in the current acceptance release.
- HTTP vhost probe on the expected IP returns `308` to `https://api.swfi.com/docs`.
- Acceptance API control still passes at `https://swfipn.activemirror.ai/docs`.
- API-key lifecycle passes at `https://swfipn.activemirror.ai/v1/admin/api-keys` with service-token auth: create, one-time secret return, managed-key use, list without secret/hash leakage, revoke, and rejected-after-revoke.

The remaining API blocker is DNS/certificate cutover: public DNS still sends `api.swfi.com` to `67.207.93.157`.

## Admin API Product Console Progress

The accepted public host now passes the Admin API Product Console UI gate:

- `/swficc/admin/` renders the protected operator console.
- Browser workflow loads product API key metadata, creates a managed key, displays the generated one-time secret to the operator, and revokes the created key.
- The UI calls the protected `/v1/admin/api-keys` API; no service token is embedded in frontend source or written to receipts.
- The receipt does not expose the generated API key secret or key hashes.
- Real SWFI auth/session integration remains deferred.

## SWFI Session Bridge Progress

The SWFI session bridge contract is now implemented in the static edge and covered by a dedicated gate:

- Bridge callback: `/swficc/auth/bridge/`.
- Expected assertion: SWFI-signed HMAC/JWT-style payload with issuer, audience, subject/email, roles, issued-at, and expiry.
- Verified local mechanics: invalid/expired assertions are rejected, valid assertions create an HTTP-only session, protected `/swficc` detail routes become reachable, and the edge forwards user identity plus backend service-token authorization to protected user APIs without exposing backend credentials in the browser.
- Current public status: blocked until the target runtime has `SWFIPN_SWFI_SESSION_BRIDGE_SECRET`, `SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED=1`, the expected issuer/audience, and SWFI sign-in returns a signed assertion to the bridge callback.
- Gate: `output/swfipn-swfi-session-bridge-brd-gate-latest.json`.

This is not a claim that real SWFI auth/session integration is complete on the accepted public runtime.

## Admin Governance Progress

The Admin Governance slice passes on the accepted public host:

- Protected APIs exist for permissions, organizations, users, and content workflow records.
- Role checks enforce the BRD matrix: Viewer is read-only, Admin cannot delete users/orgs, Editor can create content but not users/orgs, Super Admin can deactivate users/orgs.
- Organization validation enforces unique names, valid email, max users, API access, and date logic.
- User creation links to an active organization, enforces unique email, honors max users, and generates one-time API keys for API-enabled organizations.
- Content workflow records support section/status validation for draft/review/publish workflows.
- The browser gate exercises `/swficc/admin/` and writes no service token, generated API key, key hash, or temporary password to receipts.
- Welcome email delivery uses the SendGrid provider path when configured; the accepted public runtime still does not claim welcome email delivery because SendGrid is not configured there.
- Real SWFI auth/session integration is not claimed.

## Current Validation Claim

The current `/swficc` dashboard/terminal scope is deployed, source-backed, mapped, leakage-checked, and sendable for validation.

The remaining work is not a hidden dashboard bug claim; it is explicit deferred BRD Phase 2 productization and production API cutover scope.
