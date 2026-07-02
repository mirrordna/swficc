# SWFI Dashboard Validation Checklist

Use this checklist for stakeholder validation of the current `/swficc` dashboard release.

For each item, capture:

- tested URL,
- auth state,
- expected result,
- actual result,
- screenshot or receipt,
- status: `PASS`, `FAIL`, `BLOCKED`, or `UNPROVEN`.

## Dashboard Experience

- [ ] Dashboard loads publicly at `https://swfipn.activemirror.ai/swficc/`.
- [ ] SWFI logo, red brand band, navigation, typography, and layout feel consistent with the SWFI platform.
- [ ] The dashboard does not show internal labels, object IDs, backend identifiers, source gaps, API labels, or diagnostics.
- [ ] The dashboard presents insights and visual summaries rather than raw database tables as the default experience.
- [ ] The first section shows institution intelligence, including entity-type coverage, active investors, fundraising institutions, and industry/category trends.

## Visualization And Insight

- [ ] KPI cards show meaningful summary values and compact visual cues.
- [ ] Institution coverage is grouped by entity type.
- [ ] Top Active Investors uses a 30-day activity window for the dashboard overview.
- [ ] Recently Fundraising Institutions shows live opportunity/RFP-linked institutions.
- [ ] Industry/category trends are shown visually, not as a plain raw-data dump.
- [ ] Expanded sections expose charts, rankings, filters, exports, or analytical detail where useful.

## Navigation

- [ ] Every clickable dashboard row/action has a clear destination.
- [ ] Unauthenticated users are redirected to sign in when opening protected record workflows.
- [ ] The intended destination is preserved through sign-in.
- [ ] Authenticated users land on the intended SWFI-backed record/workflow.
- [ ] No visible dashboard link points to a wrong record, blank shell, placeholder page, or internal source/debug page.

## Data Accuracy

- [ ] Displayed values match the approved backend packets.
- [ ] Rankings preserve approved order, values, names, countries, entity types, and record links.
- [ ] Active investor ranking is based on completed buyer/acquirer-side transactions within the selected date range.
- [ ] Missing or stale packets do not silently render as current facts.
- [ ] No generated, inferred, or fallback business values appear as product truth.

## Search And Discovery

- [ ] Search accepts entity, people, transaction, news, and opportunity terms.
- [ ] Results are useful and link to the appropriate destination.
- [ ] Search pages avoid raw internal language and backend identifiers.
- [ ] Filters and sorting work where an analytical table is intentionally used.

## Exports

- [ ] CSV export works where shown.
- [ ] PNG export works where shown.
- [ ] Exported labels are customer-facing.
- [ ] Exports do not include internal proof/debug wording.

## Mobile

- [ ] Mobile loads the top-level dashboard.
- [ ] Search remains usable.
- [ ] KPI cards and visual sections do not overlap or clip important text.
- [ ] Links are tappable.
- [ ] Mobile is useful as a quick lookup surface, not a dense research terminal.

## Evidence Commands

Run these after each candidate release:

```bash
npm run brd:section-visualization:gate:public
npm run link:escape:gate:public
npm run acceptance:gate:public
npm run kp:gate:public
```

Additional deeper checks:

```bash
npm run source-truth:gate:public
npm run route-parity:gate:public
npm run manifest:source-destination:public
npm run brd:contract-truth:gate:public
```

If a command fails, do not summarize it as passed. Record the failing receipt path and the exact blocker.
