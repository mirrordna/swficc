# SWFIPN Full-Universe Mapping Gate

This gate proves backend record mapping coverage for the public SWFIPN dashboard contract.

It is intentionally separate from normal acceptance smoke tests because it walks the full backend record universe instead of sampling visible rows.

## Command

```bash
npm run universe:map:public
```

Default scope:

- `entities`
- `people`
- `transactions`
- `compass`
- `news`
- `reports`

Reports are enumerated through `/api/source-data/scan/v1?collection=reports`.

## Output

- Latest receipt: `output/swfipn-full-universe-mapping-latest.json`
- Per-family row evidence: `output/full-universe/swfipn-full-universe-{run_id}-{family}.ndjson`

Each NDJSON row records:

- backend family
- source id
- source URL or legacy source marker
- expected redirect
- generated click href
- warnings
- failures

## Acceptance Rules

The gate fails on:

- missing source id
- missing source URL
- wrong family mapping
- invalid source URL
- duplicate family/id, source URL, or click href
- bad SWFI sign-in handoff
- bad internal research detail route
- cursor loops or truncated enumeration
- source total drift during a full run
- reports contract missing, unless explicitly excluded by operator scope

Partial canary runs do not exit successfully unless `SWFIPN_UNIVERSE_ALLOW_PARTIAL_EXIT=1` is set.

Sharded runs are blocked by default because they are partial receipts until aggregated.

## Latest Hardened Run

Run id: `20260626171025`

Status: `pass`

Counts:

- source total: `932,047`
- rows seen: `932,047`
- rows written: `932,047`
- rows passed: `932,047`
- rows failed: `0`

Family results:

- entities: `595,102 / 595,102` pass
- people: `132,132 / 132,132` pass
- transactions: `182,189 / 182,189` pass
- compass: `4,883 / 4,883` pass
- news: `17,663 / 17,663` pass
- reports: `78 / 78` pass

Current mapping blockers: none for this mapping receipt.

This gate proves backend record mapping coverage only. It is not full universe parity and is not a substitute for:

- exhaustive detail/API route rendering,
- exhaustive required-field parity,
- exhaustive browser route/link parity,
- current visual baseline,
- adversarial review.

Full universe parity remains `UNPROVEN` unless `output/swfipn-brd-contract-truth-gate-latest.json` passes.
