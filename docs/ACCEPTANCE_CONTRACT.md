# SWFI Acceptance Contract

Frozen spec: BRD v1.3 + Feedback 2026-06-27.

## Floor

`NEVER_EVER_LIE` -> `VOLUNTEER_BAD_NEWS` · `NO_ASSUMPTIONS` · `NO_GUESSING` · `source-backed` · `NO_HARDCODING`

## Rules

- No readiness claim without current evidence.
- No assumptions or guessing about auth, routes, data mappings, counts, rankings, source freshness, or visual parity.
- No hardcoded business facts, record IDs, counts, rankings, credentials, source mappings, or expected values as product truth.
- Fixed IDs or records may be used only as named regression samples.
- User-visible business data must be source-backed or hidden/blocked.
- Bad news comes first: failures, blockers, stale proof, and unproven areas precede successes.
- `200 OK` is not acceptance.
- A link passes only when the destination contains the expected business record.
- A metric passes only when source and calculation are proven.
- Authenticated flow passes only when a logged-in workflow lands on the expected record.

## Enforcement

- Provenance gate: partial, currently figures and figure-bearing arrays.
- Data-parity harness: required.
- Visual baseline: pending.
- Adversarial review: required.

Pending, skipped, stale, or harness-failed proof does not count as accepted.

## Full Universe Parity

Full universe parity is not the same as full universe mapping.

Full universe parity may only be claimed when all layers pass with current receipts:

- source/destination manifest
- source universe mapping coverage
- every mapped detail/API route renders
- every required source field matches the mirror/backend value
- browser route/link parity is exhaustive, not sampled
- visual baseline is current
- adversarial review is current

If any layer is sampled, stale, missing, blocked, harness-failed, or not implemented, full universe parity is `UNPROVEN`.

Guard command:

```bash
npm run brd:contract-truth:gate:public
```

Source/destination manifest command:

```bash
npm run manifest:source-destination:public
```

The manifest is mapping evidence only. It does not upgrade full universe parity unless the contract truth gate passes.

## Output

Every acceptance claim must produce a receipt with:

- requirement
- tested URL
- auth state
- expected result
- actual result
- evidence path or trace
- status: `PASS`, `FAIL`, `BLOCKED`, or `UNPROVEN`
