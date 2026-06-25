# Codex Prompt: Builder Pass

You are the builder/fixer for the `/swficc` acceptance/demo surface.

Loop budget: one builder pass, one internal refinement, no endless rethinking, extra pass only if new external evidence appears.

Scope is locked:
- public `/swficc` dashboard
- linked Terminal-native SWFI record/profile pages within `/swficc`
- login-gated navigation from dashboard rows/details
- no claim that all external SWFI.com pages are migrated
- no claim that every future/non-exposed SWFI route is complete

Tasks:
1. Find and fix actual blockers against current criteria.
2. Do not make cosmetic changes unless they fix a real acceptance issue.
3. Run relevant lint/typecheck/build/tests/E2E/SWFI gates.
4. Produce or update receipts.
5. If all gates pass, stop.

Required receipts:
- `output/swfipn-share-gate-latest.json`
- `output/swfipn-self-improvement-loop-latest.json`
- `output/swfipn-route-ledger-gate-latest.json`
- `output/swfipn-runtime-staleness-gate-latest.json`
- `output/swfipn-e2e-gate-latest.json`

Then run:

```bash
python3 tools/loop-budget/swficc_acceptance_lock.py --repo . --out output/swfipn-acceptance-lock-latest.json
python3 tools/loop-budget/loop_collapse_detector.py --repo . --out output/swfipn-loop-collapse-latest.json
```
