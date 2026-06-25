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
- Row/action links must either stay inside `/swficc/` or use the approved SWFI auth handoff where that is explicitly the scoped behavior.
- Dashboard rows must resolve to the corresponding SWFI record/profile page within `/swficc` where an internal record exists.
- SWFI.com URLs are retained as provenance/source references, not as a reason to eject the user from the SWFIPN workflow.

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

This keeps users inside the SWFIPN record workflow while preserving SWFI.com as provenance.

## Remaining Caveat

Reports are still excluded from Phase 2 backend-complete status until a dedicated source-backed reports endpoint and collection contract exists.

Do not call reports backend-complete until that contract exists and passes the same list/detail/source receipt checks.

Authenticated navigation is not yet fully automated in the acceptance harness. The public gate passes with auth checks skipped because `/swficc/login` currently hands off to SWFI.com sign-in, while the existing harness still targets an internal login form.

## Required Language

Use:

> corresponding SWFI record/profile page within `/swficc` where an internal record exists

Do not claim:

> all existing SWFI.com profile pages are migrated

unless a separate route-universe receipt proves that exact claim.
