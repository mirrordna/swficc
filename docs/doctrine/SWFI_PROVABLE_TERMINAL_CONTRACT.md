# SWFI Provable Terminal Contract

This contract converts the SWFI build-pack doctrine into a deployable terminal gate.

## Doctrine

- The model may manage workflow, fetch approved evidence, summarize verified facts, and propose corrections.
- The model may not become the database, invent missing facts, silently merge conflicts, or serve unsourced financial values.
- Mongo/SWFI production data is the product data rail.
- SWFI.com URLs are provenance/final-source references, not a reason to eject the user from SWFIPN.

## Required Truth States

Visible facts must resolve to one of:

- `FACT`
- `DERIVED`
- `ANALYSIS`
- `SIGNAL`
- `CONFLICT`
- `STALE`
- `UNKNOWN`

Lower-case backend variants are accepted only when normalized by the gate.

## Evidence Chain

Every fact-bearing row should preserve:

- stable record id
- source URL
- final URL when available
- source collection/API endpoint
- truth state/result qualifier
- frontend route where the user can inspect it

## Parity Checks

The terminal is not provable until these paths pass together:

- DB/Mongo mirror count -> API count
- API row -> frontend row/detail link
- frontend link -> internal SWFIPN detail/source page
- dashboard widget -> source-backed API packet
- route controls -> sort/filter/page/row-count proof

## In-Scope Widgets

- institution counts
- active allocators
- top entities by AUM
- live RFPs/mandates
- recently fundraising institutions
- recent transactions
- top active investors
- compare/profile detail surfaces

## Failure Classes

- `FACT_MISMATCH`
- `ROW_SHIFT`
- `ROW_DROP`
- `SORT_DIVERGENCE`
- `FILTER_DIVERGENCE`
- `EXPORT_MISMATCH`
- `SOURCE_MISSING`
- `FINAL_LINK_NOT_FETCHED`
- `STALE_VALUE`
- `ENTITY_ALIAS_COLLISION`
- `NULL_SEMANTICS_ERROR`
- `UNKNOWN`

## Gate Rule

No Prem-facing readiness claim may be made without a fresh provable terminal receipt under `output/swfipn-provable-terminal-gate-latest.json`.
