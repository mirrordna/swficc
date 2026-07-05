# SWFIPN Phase 1 Absorption and Phase 2 Evolution

Status: active boundary contract
Last updated: 2026-06-24

## Purpose

Phase 2 absorbs the parts of SWFI 1 that were proven useful, then evolves only the backend/data/record-correctness spine.

This is not a license to carry forward brittle legacy assumptions. It is a lock on the SWFI 1 acceptance behavior that must remain true while Phase 2 hardens source-backed records.

## Absorbed SWFI 1 Baseline

The following Phase 1 behaviors are treated as invariants:

- Public `/swficc/` dashboard renders without login.
- SWFI brand shell, red header, logo placement, public navigation, and dashboard layout remain recognizable as SWFI.
- Public dashboard exposes only top-level, whitelisted information.
- Public UI does not expose object IDs, backend names, Active Mirror labels, raw diagnostics, API labels, or source receipt internals.
- Row/action links must either stay inside `/swficc/` for dashboard discovery or use the approved SWFI auth handoff for protected SWFI platform records.
- Dashboard record rows must preserve the corresponding SWFI `/v1/...` target through sign-in handoff.
- SWFI.com URLs are used for the approved platform/auth handoff, not as arbitrary external escapes or debug provenance pages.

Latest baseline receipt:

- `output/swfipn-phase1-public-dashboard-gate-latest.json`
- Status: `pass`
- Generated: `2026-06-24T10:01:21.584Z`
- Record links checked: 25

## Phase 2 Evolution

Phase 2 evolves the system through backend correctness only:

- canonical Mongo-backed source mapping
- deterministic ranking logic
- internal source receipts
- staleness handling
- list/detail record resolution
- acceptance proof
- self-contained deployment spine with web, backend, Mongo vault, sync, health, and ingress as one unit

No Phase 2 change may introduce:

- fake values
- inferred fallbacks
- frontend MongoDB access
- subscriber-only fields directly on the public dashboard
- uncontracted AI/model-generated data
- decorative features that hide source gaps

## Current Evolution Receipt

Latest Phase 2 backend receipt:

- `output/swfipn-phase2-backend-acceptance-latest.json`
- Status: `pass`
- Stage: `phase2_backend_contract_ready_for_swfi_validation`
- Generated: `2026-06-24T16:01:09.201Z`

Latest record-universe bridge receipt:

- `output/swfipn-record-mirror-gate-latest.json`
- Status: `pass`
- Generated: `2026-06-24T15:59:18.207Z`
- Total mirrorable records sampled from source contracts: 931,337
- Classes covered: entities, people, transactions, Compass/RFP, news

Latest self-contained runtime receipt:

- `output/swfipn-self-contained-stack-latest.json`
- Status: `pass`
- Generated: `2026-06-24T15:59:19.611Z`
- Covered: Docker Compose stack, Kubernetes template, in-stack Mongo, sync job, health checks, and no host/laptop backend dependency.

The route bridge fix is intentionally narrow:

- `/swficc/v1/entities/{id}` redirects to `/swficc/profiles/detail/?id={id}&source=https://www.swfi.com/v1/entities/{id}`
- `/swficc/v1/people/{id}` redirects to `/swficc/people/detail/?id={id}&source=https://www.swfi.com/v1/people/{id}`
- `/swficc/v1/transactions/{id}` redirects to `/swficc/transactions/detail/?id={id}&source=https://www.swfi.com/v1/transactions/{id}`
- `/swficc/v1/compass/{id}` redirects to `/swficc/mandates/detail/?id={id}&source=https://www.swfi.com/v1/compass/{id}`

Historical note: this internal record-workflow bridge has been superseded for dashboard-originated record clicks. The current team direction is for the public dashboard to remain a curated preview and hand protected record clicks to SWFI sign-in with the intended `/v1/...` platform record redirect preserved.

## Remaining Caveat

Reports are still excluded from Phase 2 backend-complete status until a dedicated source-backed reports endpoint and collection contract exists.

Do not call reports backend-complete until that contract exists and passes the same list/detail/source receipt checks.

Authenticated navigation is tested as SWFI sign-in handoff unless a target runtime explicitly enables local authenticated validation. The dashboard must not introduce custom auth for Phase 1 preview access.

## Required Language

Use:

> corresponding SWFI core platform record/profile page through SWFI sign-in handoff

Do not claim:

> all existing SWFI.com profile pages are mirrored inside SWFIPN

unless a separate route-universe receipt proves that exact claim.
