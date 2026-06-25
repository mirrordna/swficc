<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
# Loop Budget Acceptance Rules

## Prime directive

Do not optimize for sounding done. Optimize for receipt-backed acceptance.

## Loop budget

```json
{
  "max_builder_passes": 1,
  "max_prosecutor_passes": 1,
  "max_internal_refinements_per_pass": 1,
  "extra_passes_allowed_only_if": "new_external_evidence"
}
```

After the builder pass and prosecutor pass, stop unless there is new external evidence.

## Current `/swficc` acceptance scope

- public `/swficc` dashboard
- linked Terminal-native SWFI record/profile pages within `/swficc`
- unauthenticated login-gated navigation
- authenticated internal `/swficc` record navigation

Do not claim all external SWFI.com pages are migrated, every SWFI route is complete, every future dashboard module is accepted, or all data parity is globally verified unless specific receipts prove it.

## Required wording

Use: “corresponding SWFI record/profile page within `/swficc` where an internal record exists.”

Do not use: “all existing SWFI.com profile pages” unless external SWFI.com routing is explicitly implemented and tested.

## Blockers

- wrong dashboard numbers
- broken dashboard links
- failed unauthenticated login redirect
- authenticated route goes to wrong record
- visible object IDs or database IDs
- visible Active Mirror/internal diagnostic labels
- raw API/debug/backend errors visible to users
- restricted/private data exposed publicly
- dashboard cannot render public `/swficc`
- latest acceptance gate receipt fails

## Phase 2, not blocker

- migration of all external SWFI.com pages
- additional dashboard modules not currently exposed
- new premium workflows
- deeper source-validation beyond current receipt coverage
- expanded mobile refinements beyond non-broken usability
- new analytics requirements
- new admin tooling

## Required receipts

- `output/swfipn-acceptance-lock-latest.json`
- `output/swfipn-loop-collapse-latest.json`
- `docs/swfipn-acceptance-status.md`

Final verdict must be `go`, `go_with_caveat`, or `no_go`. Never say “perfect.”
