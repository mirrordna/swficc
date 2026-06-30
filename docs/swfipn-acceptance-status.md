# SWFI /swficc Acceptance Status

Status: In BRD hardening; not full-BRD complete

Scope: current `/swficc` dashboard/terminal validation scope plus BRD v1.3 infra/productization receipts.

This does not claim that full BRD Phase 2 productization is complete.

Public URL: `https://swfipn.activemirror.ai/swficc/`

Deployed release: `/opt/swfipn-acceptance/releases/20260630T095954Z`

Public asset version: `20260630T0954Z-redis-cache`

## Verdict

BRD truth matrix: `NOT_100_PERCENT_BRD_COMPLETE`

Infra blocker rollup: `open_external_inputs_required`, `3 open / 2 closed`

Search SLA: `pass`, repeated public gate `5/5`

Redis cache: `pass`, runtime Redis PONG proven on DO

CDN/static assets: `pass`; remote CI run proof still missing

Runtime staleness: `pass`, failures `0`

Production API DNS cutover: `blocked`

## Blockers

- Full BRD remains blocked on three receipt-backed external/productization items:
  - Mongo indexes: apply reached Atlas, but the configured MongoDB user is not authorized for createIndexes on swfi.
  - SendGrid: code/gate present, but target runtime lacks SWFI-specific API key/from-address.
  - CDN/CI: Cloudflare/static assets and zero high/critical npm audit are proven, but current successful remote GitHub Actions run receipt is missing.

## Deferred / Blocked Outside Current Sendable Scope

- `api.swfi.com` production cutover remains blocked outside the current `/swficc` sendable scope.
  - dns:a_record_not_cut_over_expected_161.35.56.218_got_67.207.93.157
  - production:docs_http_404
  - production:docs_status_missing
  - production:docs_base_url_missing
  - production:docs_missing_x_api_key_auth
  - dns_cutover_controller:digitalocean_token_lacks_dns_write_permission
- Phase 2 runtime integrations remain blocked outside the current `/swficc` sendable scope.
  - sendgrid_target_runtime_missing_api_key
  - sendgrid_target_runtime_missing_from_email
  - only_non_swfi_sendgrid_candidate_found_do_not_claim_sendgrid

## Latest Evidence

| Gate | Result | Receipt |
| --- | --- | --- |
| Share/sendability gate | `fail` | `output/swfipn-share-gate-latest.json` |
| Acceptance criteria gate | `pass` | `output/swfipn-acceptance-criteria-gate-latest.json` |
| KP acceptance gate | `pass` | `output/swfipn-kp-acceptance-gate-latest.json` |
| Route and leakage gates | `pass` | `output/swfipn-link-mapping-leakage-gate-latest.json, output/swfipn-visible-link-escape-gate-latest.json` |
| BRD Phase 2 gate | `pass_with_deferred_scope` | `output/swfipn-brd-phase2-acceptance-latest.json` |
| Runtime staleness gate | `pass` | `output/swfipn-runtime-staleness-gate-latest.json` |
| API product gate | `pass` | `output/swfipn-api-product-gate-latest.json` |
| API key lifecycle gate | `pass` | `output/swfipn-api-key-lifecycle-latest.json` |
| Admin API Product Console UI gate | `pass` | `output/swfipn-admin-api-ui-brd-gate-latest.json` |
| Admin Governance gate | `pass` | `output/swfipn-admin-governance-brd-gate-latest.json` |
| Saved Searches backend/API + linked alert delivery gate | `pass` | `output/swfipn-saved-searches-brd-gate-latest.json` |
| Saved Searches page UI + linked alert delivery gate | `pass` | `output/swfipn-saved-searches-ui-brd-gate-latest.json` |
| Alerts backend/API gate | `pass` | `output/swfipn-alerts-brd-gate-latest.json` |
| Alerts page UI gate | `pass` | `output/swfipn-alerts-ui-brd-gate-latest.json` |
| Alert delivery receipts gate | `pass` | `output/swfipn-alert-delivery-brd-gate-latest.json` |
| SendGrid email delivery gate | `blocked` | `output/swfipn-sendgrid-email-brd-gate-latest.json` |
| Search SLA repeated gate | `pass` | `output/swfipn-search-gate-repeated-latest.json` |
| Redis cache runtime gate | `pass` | `output/swfipn-redis-cache-gate-latest.json` |
| CDN static asset gate | `pass` | `output/swfipn-cdn-static-assets-gate-latest.json` |
| BRD infra blocker rollup | `open_external_inputs_required` | `output/swfipn-brd-open-infra-blockers-latest.json` |
| SWFI session bridge gate | `blocked` | `output/swfipn-swfi-session-bridge-brd-gate-latest.json` |
| Phase 2 runtime preflight | `blocked` | `output/swfipn-phase2-runtime-preflight-latest.json` |
| Phase 2 closure packet | `blocked_waiting_on_external_runtime_inputs` | `output/swfipn-phase2-closure-packet-latest.json` |
| API DNS cutover gate | `blocked` | `output/swfipn-api-dns-key-lifecycle-latest.json` |
| API DNS cutover controller | `blocked` | `output/swfipn-api-dns-cutover-latest.json` |

## Share Summary

- receipts: `9`
- screenshots: `3`
- failures: `6`
- source_links: `46`
- detail_links: `21`
- mirror_record_links: `67`
- external_swfi_links: `0`

## Data Quality Caveats

- backend_source_record_quarantine: 6 unreadable backend source records quarantined by full manifest scan.

## Phase 2 / Change Requests

- Admin API-key lifecycle UI and Admin Governance pass on the accepted public host; real SWFI auth/session integration remains deferred P2 until the SWFI session bridge gate passes against the target runtime.
- Alerts backend/API, Alerts page UI API client, and alert in-app/webhook delivery receipts pass on the accepted public host. SendGrid email delivery code and gate are deployed, but public email delivery remains blocked until the target runtime has a configured SendGrid key/from-address and the SendGrid email gate passes.
- Saved Searches backend/API, page UI API client, and linked in-app alert delivery receipts pass on the accepted public host; local SWFI session bridge mechanics are receipt-backed, but real SWFI auth/session integration remains blocked until SWFI supplies signed assertions and the bridge is configured on the target runtime.
- SWFI session bridge code and gate are implemented; public runtime remains blocked until `output/swfipn-swfi-session-bridge-brd-gate-latest.json` passes with the SWFI assertion secret/return path configured.
- SendGrid onboarding remains deferred P2 until `output/swfipn-sendgrid-email-brd-gate-latest.json` passes against the target runtime.
- api.swfi.com DNS cutover remains blocked/deferred until the DNS/key lifecycle gate passes. The cutover controller found the `api` A record and rollback data, but the available DigitalOcean token lacks DNS write permission. API-key lifecycle, Admin API-key lifecycle UI, Admin Governance, Alerts backend/API, Alerts page UI API client, Alert delivery receipts, Saved Searches backend/API, Saved Searches page UI API client, and saved-search linked in-app alert delivery pass on the accepted public host.

## Required wording

Use: “The current `/swficc` deployment is live on DO and has receipt-backed search, Redis, and CDN/static asset checks, but full BRD acceptance remains blocked on Mongo index apply, SendGrid runtime config, and remote CI proof.”

Do not use: “Full BRD Phase 2 is complete.”

Do not use: “All SWFI.com pages are fully migrated.”

## Final acceptance sentence

Do not call this full-BRD complete. The current deployment is live and improved, but full BRD acceptance remains open until the three blocker receipts pass.
