# MSCI and SWFI Dashboard Email Complaint Closure

## Customer acceptance boundary

The release is not accepted merely because generic dashboard or API tests pass. The following exact complaints from the July 31 and August 6, 2026 email threads are release-blocking:

1. The dashboard visibly provides a source-backed **Top Ranked AUM** module.
2. Smart Search returns the canonical Abu Dhabi Investment Authority result for `ADIA` and searches both `ADIA` and the full institution name across relevant result lanes.
3. Smart Search returns the canonical Hong Kong Investment Corporation result for `HKIC` or the full name and searches both forms across relevant result lanes.
4. The `All` view does not silently omit people or news merely because a source row uses the institution acronym while the user entered the full name, or vice versa.
5. A zero-result state must not normalize a known multi-word search defect into acceptable product behavior.
6. Active Allocators keeps the approved SWFI core-platform sign-in handoff with the intended record/profile destination preserved.
7. The MSCI standard `/v1/entities` ETL path must independently prove its State, City, Website, and Notes field contract. That API proof belongs to the backend release and cannot be inferred from this frontend candidate.

## Candidate behavior

- `Top Ranked AUM` is the exact visible label for the source-bound ranking preview.
- Verified bidirectional query variants cover `ADIA` / `Abu Dhabi Investment Authority` and `HKIC` / `Hong Kong Investment Corporation`.
- People and news requests run across all verified query variants in parallel, merge fact packets, deduplicate rows, and rank across the same variants.
- The previous user-facing statement that multi-word news search was a known upstream gap has been removed.
- Active Allocators remains an approved SWFI sign-in handoff; it is not rewritten as an internal dashboard preview.

## Evidence required before a production claim

- Source contract receipt: `output/swfipn-msci-email-complaint-gate-latest.json`.
- Local browser receipt: `output/swfipn-msci-email-complaint-browser-gate-latest.json`, with two consecutive runs for ADIA and HKIC.
- Search relevance receipt: `output/swfipn-search-relevance-regression-latest.json`.
- Passing lint and production build.
- Independently reviewed exact source head.
- Staging run against real source data proving non-empty, correctly categorized ADIA and HKIC entity, people, and news results where those source records exist.
- Separate backend `/v1/entities` staging receipt for the MSCI field contract.
- Explicit production approval, rollback-safe deployment, then fresh production browser/API receipts. Local or staging evidence must never be relabeled as production proof.

## Bad news and remaining risk

- This candidate does not change production.
- Source data may legitimately contain no people or news row for an institution. The live gate must distinguish a genuine source-empty result from an alias/query failure and preserve that evidence.
- The current production release was previously recorded from a dirty worktree, so a git SHA alone does not bind its full deployed source. A clean immutable release binding is required at the next approved deployment.
- The current high-threshold dependency audit reports 14 findings (two moderate, 12 high, zero critical). They are not silently upgraded in this complaint fix; they remain separate security hardening debt requiring compatible, tested upgrades.
