# SWFI Dashboard Release SOP

Scope: current `/swficc` dashboard validation release.

## Release Rule

Do not call a release ready based only on HTTP 200 responses, build success, or a visual glance. A release is ready for validation only when the relevant gates pass and the remaining caveats are documented.

## Preflight

1. Confirm the repo and branch.

```bash
pwd
git status --short
git log -3 --oneline
```

2. Build the app.

```bash
npm ci
npm run lint
npm run build
npm run brd:npm-audit:high
```

3. Check data/index/runtime readiness where the release touches data contracts.

```bash
SWFIPN_DB_INDEX_DRY_RUN=1 npm run db:indexes
npm run do:inventory
npm run runtime:phase2:preflight:public
node scripts/swfipn-refresh-home-snapshot.mjs
```

4. Run focused product gates before deployment.

```bash
npm run brd:section-visualization:gate:public
npm run link:escape:gate:public
npm run acceptance:gate:public
```

5. For deeper acceptance scope, run the current acceptance stack and parity checks.

```bash
npm run acceptance:stack:public
npm run share:gate:public
npm run brd:contract-truth:gate:public
npm run manifest:source-destination:public
npm run phase2:backend:acceptance:public
npm run universe:map:public
npm run route-parity:gate:public
npm run detail-batch:parity:public
npm run record:field-parity:full:public
npm run adversarial:review:public
npm run acceptance-lock
npm run loop-collapse
```

`npm run brd:api-dns:cutover` may be used as a DNS preflight. Do not apply DNS cutover unless the operator deliberately sets `SWFIPN_API_DNS_APPLY=1`.

Use authenticated gate credentials only through environment variables. Do not commit credentials into documentation, scripts, or source files.

## Deployment

Deploy using the existing project deploy workflow. When using the bundled acceptance workflow, the deploy command is:

```bash
npm run acceptance:stack:deploy
```

After deployment, confirm the latest strict deploy receipt:

```bash
cat output/swfipn-strict-acceptance-deploy-latest.json
```

The receipt must identify:

- status,
- release path,
- deployed domain,
- asset version,
- git SHA,
- dirty state.

## Postflight

1. Confirm the public page renders the intended release.

```bash
node - <<'NODE'
const res = await fetch('https://swfipn.activemirror.ai/swficc/');
const html = await res.text();
console.log({
  status: res.status,
  hasDashboard: html.includes('Institution Intelligence Overview'),
  hasOldAumLabel: html.includes('Total AUM Engaged'),
  hasInternalLeak: /Active Mirror|BRD|deterministic|Glass Box|source_gap|backend identifier/i.test(html)
});
NODE
```

2. Re-run public gates.

```bash
npm run brd:section-visualization:gate:public
npm run link:escape:gate:public
npm run acceptance:gate:public
npm run kp:gate:public
```

3. Browser-check the dashboard.

Minimum browser proof:

- page URL is `https://swfipn.activemirror.ai/swficc/`,
- title is `Sovereign Wealth Fund Institute`,
- first meaningful dashboard section is visible,
- no framework error overlay,
- no relevant console errors,
- at least one dashboard section expands/collapses,
- screenshot saved or attached to the release note.

## Feedback Intake

Every feedback item should be triaged into one of these buckets:

- Data accuracy
- Metric definition
- Visualization / dashboard usefulness
- Navigation / auth handoff
- UI copy / internal language leakage
- Performance
- Accessibility / mobile
- Out of current validation scope

For each accepted defect, record:

- tested URL,
- expected behavior,
- actual behavior,
- screenshot or receipt,
- owning component or endpoint,
- fix commit,
- post-fix receipt.

## Release Note Format

Use this format when asking the SWFI team to validate a build:

```text
Completed:
- [Short list of exactly what changed]

Milestone:
- Current /swficc dashboard validation build

Ready for validation:
- [Specific workflows or sections to test]

Validation link:
- https://swfipn.activemirror.ai/swficc/

Known caveats:
- [Only current caveats backed by receipts]
```

Do not say:

- full BRD Phase 2 is complete,
- all SWFI pages are migrated,
- full universe parity is proven,
- perfect or final,
- anything that is not backed by the latest receipts.
