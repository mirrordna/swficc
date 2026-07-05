# SWFI Dashboard Integration and UX Contract

Status: live acceptance contract

## Scope

This contract governs the public `/swficc/` dashboard and links launched from that dashboard.

## Platform Integration

The dashboard must render as a SWFI platform surface:

- SWFI logo text is visible in the header.
- Sovereign Wealth Fund Institute brand text is visible in the header.
- The header uses the SWFI red brand band.
- Primary navigation is visible and stable across desktop and mobile widths.
- Dashboard rows and actions stay inside `/swficc/` product routes unless the user deliberately opens a source record action.

## Source-Page Parity Rule

SWFI-branded navigation pages are not complete because the route exists or the label matches.

When a SWFI.com page is brought into SWFIPN:

- The internal `/swficc/` page must be a source-parity port from the corresponding live SWFI.com page or canonical SWFI record.
- The page must not redirect to SWFI.com.
- The page must not be a placeholder, label-only summary, recycled dashboard page, or provenance workbench substitute.
- Visible content must be meaningful business content from the source page or source-backed SWFI records.
- Forms must not fake submission success. If no contracted backend handler exists, they must either use a real contracted destination or make the missing handler explicit in the readiness ledger, not in the client UI.
- Acceptance requires route-specific gate evidence comparing the internal route with the source route or source record.

## Authentication and Navigation

Top-level dashboard information may render without login.

Every non-public dashboard hyperlink must follow this rule:

- Unauthenticated user: redirect to SWFI sign-in with the intended `/v1/...` platform record target preserved.
- Authenticated user: go directly to the intended SWFI core platform record or workflow route after SWFI authentication.

Institutional rows must navigate to the matching SWFI platform profile route through the configured handoff:

- `https://www.swfi.com/v1/signin/?msg=auth&redirect=/v1/entities/{id}`

Transaction, mandate, people, and research rows must navigate to the matching SWFI platform record where a canonical SWFI record target exists. Dashboard-only analytical drilldowns may stay inside `/swficc`.

## Data Presentation

Visible dashboard text must be meaningful business information only.

Forbidden visible text includes:

- object ids
- backend identifiers
- endpoint names
- schema versions
- source filters
- source gap reasons
- Active Mirror diagnostics
- runtime diagnostics
- parser or crawler internals

Allowed visible source language:

- `Data source: SWFI records`
- `SWFI source` when it opens an internal source-backed detail route
- explicit `Source gap` only when the source contract is not factual

## Validation

Dashboard facts must come from SWFI source-backed backend packets or explicit source gaps.

## Client Feedback Acceptance Criteria

This checklist is the external acceptance standard for the dashboard integration work:

- The dashboard look and feel must be consistent with the existing SWFI website, including logo placement, visual design, fonts, color scheme, page layout, and overall user experience.
- The dashboard must be accessible without requiring users to log in.
- For unauthenticated users, following a dashboard hyperlink must redirect to the SWFI login page.
- For authenticated users, following a dashboard hyperlink must take them directly to the appropriate existing SWFI core platform profile or record page after SWFI authentication.
- The dashboard must hide all internal technical details, including object IDs, Active Mirror status messages, backend identifiers, source packet fields, and system-level diagnostics.
- Tabular data rows, including ranked lists, must link to the appropriate existing SWFI-backed page. For unauthenticated users, those row links must redirect to the SWFI login page.
- Top AUM rankings must match the approved SWFI source packet exactly: values, order, names, countries, entity types, and profile links.
- Displayed dashboard packets must have fresh source receipts. Stale source packets must not render silently.
- Every visible dashboard row, link, and action must be tested in both unauthenticated and authenticated states.
- Record detail destinations must render the expected SWFI-backed record details, not only a linked shell.
- Authenticated users must keep session continuity when moving from dashboard to records.
- Mobile must render meaningful top-level data, usable search, clean links, and no broken clipping or zero-row panels unless the source is truly empty.
- Performance must remain inside the agreed first-usable and link-resolution targets.
- Accessibility and UX must keep keyboard/link surfaces readable, table controls obvious, and links non-fake.
- Public dashboard security must expose only allowed top-level information and no service tokens, source internals, or API errors.
- Every acceptance run must emit an evidence pack with requirement, test case, public expected result, authenticated expected result, actual result, evidence, status, owner, and blocker.

Acceptance mapping:

- Look and feel: `acceptance:gate:public`, backed by screenshots for desktop and mobile.
- Public dashboard access: `acceptance:gate:public` unauthenticated browser check.
- Unauthenticated dashboard link redirect: `acceptance:gate:public` verifies gated dashboard record links point to SWFI sign-in with the intended `/v1/...` platform target preserved, then clicks samples.
- Authenticated dashboard link direct navigation: `acceptance:gate:public` with `SWFIPN_AUTH_TEST_USERNAME` and `SWFIPN_AUTH_TEST_PASSWORD`.
- No internal technical details: `acceptance:gate:public` forbidden-visible checks plus link-token leak checks.
- Table row navigation: `acceptance:gate:public` verifies dashboard table row links preserve SWFI core platform record targets.
- Data parity: `acceptance:gate:public` compares visible dashboard values and Top AUM rows to live SWFI fact packets.
- Staleness: `acceptance:gate:public` verifies packet `generated_at`, provenance source, and source document receipts.
- Route/detail/session parity: `acceptance:crawl:public` clicks every visible dashboard link while logged out and logged in.
- Evidence pack: `acceptance:crawl:public` writes a client-facing matrix and per-link crawl receipt.

Acceptance gates:

```bash
SWFIPN_AUTH_TEST_USERNAME=<username> SWFIPN_AUTH_TEST_PASSWORD=<password> npm run acceptance:gate:public
SWFIPN_AUTH_TEST_USERNAME=<username> SWFIPN_AUTH_TEST_PASSWORD=<password> npm run acceptance:crawl:public
npm run kp:gate:public
SWFIPN_AUTH_TEST_USERNAME=<username> SWFIPN_AUTH_TEST_PASSWORD=<password> npm run auth:nav:gate:public
npm run source-truth:gate:public
npm run visual:gate:public
SWFIPN_TABLE_CONTROLS_LEVEL=smoke npm run controls:proof:public
SWFIPN_E2E_LEVEL=smoke npm run e2e:gate:public
```

`kp:gate:public` enforces brand/header presence, absence of visible internal diagnostics, dashboard insight anchors, internal source-backed navigation, and RIDE reachability.

`auth:nav:gate:public` enforces unauthenticated login redirects, profile-row `next` preservation, brand-header login redirects, and authenticated direct navigation when test credentials are available.

`acceptance:gate:public` is the single client-feedback checklist gate. It fails if credentials are missing unless `SWFIPN_ACCEPTANCE_ALLOW_AUTH_SKIP=1` is set for a public-only run. The receipt is written to `output/swfipn-acceptance-criteria-gate-latest.json`.

`acceptance:crawl:public` is the dashboard acceptance crawler. It tests every visible dashboard link twice: unauthenticated and authenticated. It writes `output/swfipn-dashboard-acceptance-crawler-latest.json` and `output/swfipn-dashboard-acceptance-matrix-latest.md`.

Acceptance matrix columns:

- Requirement
- Test Case
- Public Expected
- Authenticated Expected
- Actual Result
- Evidence
- Status
- Owner
- Blocker
