# How To Use The SWFI Dashboard

Validation URL: `https://swfipn.activemirror.ai/swficc/`

## 1. Start On The Dashboard

Open the validation URL. The dashboard should load without requiring login and should show SWFI branding, navigation, search, KPI cards, and expandable dashboard sections.

The first dashboard section is the institution intelligence overview. It is intended to replace raw table browsing with visual summaries:

- total institutions tracked by entity type,
- top active investors for the last 30 days,
- recently fundraising institutions,
- investment trends by industry/category.

## 2. Use Search

Use the search box to search across entities, people, transactions, news, and opportunities.

Expected behavior:

- top-level search is available from the dashboard,
- result links should open the correct SWFI-backed record or discovery destination,
- the page should not expose internal IDs, source gaps, backend labels, or debug states.

## 3. Open Dashboard Sections

Each dashboard section can expand for more detail. Use the `+` or section title to open a section.

Expected sections include:

- Institution Intelligence Overview
- Capital Flows by Industry / Category
- Market Signals
- Pipeline Overview
- Top Active Investors
- Research & Analytics Hub
- Market Intelligence
- Upcoming Events & Engagements
- Activity Feed
- Deal Intelligence

Expanded sections should show charts, rankings, compact visual summaries, or analytical rows. Basic raw-table browsing should not be the default dashboard experience.

## 4. Navigate To Records

Click rows, ranked entities, transactions, RFPs, people, or intelligence items to continue into the matching SWFI-backed record or workflow.

Expected behavior:

- public/top-level dashboard content is visible without login,
- protected record workflows should use the configured SWFI sign-in flow,
- logged-in users should land on the intended record destination,
- unauthenticated users should be sent to sign in with the intended destination preserved.

## 5. Export Where Available

Some analytical sections support CSV or PNG export.

Expected behavior:

- exports should reflect the currently displayed dashboard data,
- export labels should be customer-facing,
- exported content should not include internal diagnostic wording.

## 6. What Not To Use It For

Do not use the dashboard as:

- a full replacement for every SWFI platform workflow,
- an admin console,
- a source debugger,
- a MongoDB browser,
- a place to inspect backend object IDs or internal records.

The dashboard is for discovery, visualization, and navigation.
