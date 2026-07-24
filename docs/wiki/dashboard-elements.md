# Dashboard Elements

Last updated: 2026-07-04

This page explains what each visible dashboard box, graph, panel, and navigation surface is meant to communicate. It is based on the current dashboard implementation in `/Users/mirror-pro/repos/swfi-dashboard/src/app/page.tsx`.

This is not an acceptance receipt. It explains meaning and intended behavior. Acceptance still requires live receipts for data parity, route parity, freshness, and UI behavior.

## Data Packets

| Packet | Endpoint | Used for |
| --- | --- | --- |
| Dashboard metrics | `/api/swfi/dashboard-metrics/v1` | Overall counts used by KPI cards and pipeline totals. |
| Institution types | `/api/institution-types/v1?limit=8` | Institution type breakdown and entity-type visual panels. |
| Allocator activity, 30 days | `/api/allocator-activity/v1?days=30&limit=25&page=1&sort=deal_count&direction=desc` | Top active investors and relationship rankings. |
| Active allocators, 90 days | `/api/active-allocators/v1?days=90&limit=1` | Active Allocators KPI and pipeline stage. |
| Live opportunities | `/api/live-opportunities/v1?limit=25&page=1` | RFPs, mandates, fundraising institutions, upcoming engagements. |
| Recent transactions | `/api/recent-transactions/v1?days=30&limit=25&page=1` | Deals, recent activity, deal intelligence. |
| Entities | `/api/source-data/search/v1?collection=entities&limit=25&page=1` | Entity search and fallback institution rows. |
| People | `/api/source-data/search/v1?collection=people&limit=25&page=1` | People search and recent people activity. |
| Top AUM | `/v1/swfi/top20?limit=25` | Total AUM Engaged, watchlist, global capital map, top institution context. |
| Intelligence news | `/api/source-intelligence/news/v1?limit=25` | News feed, research hub, ticker, intelligence search. |
| Sector flows | `/api/sector-flows/v1?days=365` | Capital flows, sector trends, market intelligence, and largest-sector share. |

## Top Navigation

| Element | Meaning | Source / behavior |
| --- | --- | --- |
| SWFI red header | Keeps the dashboard visually inside the SWFI platform experience. | Static SWFI styling and logo assets. |
| Greeting | Shows the logged-in user's display name when available. | `useDashboardSessionDisplayName()`. If no name is available, it shows a generic greeting. |
| Global Search | Opens the dashboard search modal. | Combines the live public search endpoint with the rows already loaded on the dashboard. |
| Quick action icons | Shortcuts into major work areas. | Profiles, reports, intelligence, alerts. |
| Date / data-as-of label | Shows today's browser date plus the dashboard data freshness label. | Date is local browser time. Data-as-of comes from the metrics packet. |
| Canonical nav | Main SWFI platform sections. | Dashboard, News, Entities, People, Transactions, Compass, Reports. |

## Left Command Center

| Element | Meaning | Source / behavior |
| --- | --- | --- |
| Command Center nav | Primary dashboard/workflow navigation. | Links to executive overview, people, institutions, transactions, deals, intelligence, mandates, reports, and account/settings. |
| Watchlist | Current top AUM institution rows, shown as a compact sidebar list. | Top AUM packet. This is not a personal saved watchlist unless a later backend feature explicitly supports that. |

## KPI Cards

The top row is the executive scan layer. Each card is clickable and includes a small sparkline. Sparklines are compact visual cues generated from the loaded rows, not standalone audited time-series charts.

| Card | What it means | Primary source | Click target |
| --- | --- | --- | --- |
| Total AUM Engaged | Total disclosed AUM represented by the loaded top-AUM ranking. | Top AUM packet. | Global Capital Map section. |
| Active Allocators | Count of active allocators in the selected 90-day allocator window. | Active allocators, 90 days. | Active Allocators page. |
| Disclosed Deal Value | Disclosed market/deal value from sector-flow activity, falling back to transaction metric counts when value is unavailable. | Sector flows and dashboard metrics. | Deals page. |
| Live RFPs / Mandates | Current live RFP/mandate opportunity count. | Live opportunities and dashboard metrics. | Mandates/RFPs page. |
| SWF Profiles | Count of sovereign wealth fund profiles available through the approved metrics packet. | Dashboard metrics. | Filtered institution profiles. |
| Intelligence Items | Current count of intelligence/news items. | Dashboard metrics and intelligence news packet. | Intelligence page. |

## Short Insight Tiles

| Tile | What it means | Click target |
| --- | --- | --- |
| Recently Fundraising Institutions | Shortcut to RFPs and fundraising opportunities linked into Compass records. | Mandates/RFPs page. |
| Investment Trends by Sector | Shortcut to sector activity from disclosed transactions and market-flow records. | Deals page. |

## Expandable Visual Panels

Every panel has an Open/Close control. Clicking the panel header expands an inline detail area. The "Open records" link routes to the matching records section.

| Panel | Graph / visual | What it means | Main sources | Open records |
| --- | --- | --- | --- | --- |
| Global Capital Map | Country-level map with top SWF AUM locations. | Shows where the loaded top-AUM SWFI profile rows are located by country. The marker count and record list come from SWFI profile rows. | Top AUM profile rows. | Filtered institution profiles. |
| Capital Flows & Allocation Trends | Multi-color sector ribbon chart with disclosed total and percentage shares. | Shows how disclosed sector activity is distributed across the top sector-flow rows. | Sector flows. | Deals page. |
| AI Insights | Four compact signal rows with shortcut tabs. | Combines the top allocator, largest recent deal, nearest/open mandate, and latest intelligence item into one signal panel. This is a synthesized dashboard view from source rows, not freeform generated truth. | Allocator activity, transactions, mandates, news. | Intelligence page. |
| SWFI Discovery Pathways | Linked pathway visual. | Shows the main record groups users can drill into from the dashboard: institutions, active allocators, deals, live RFPs, and top-AUM records. | Metrics, top AUM, active allocators, transactions, mandates. | Institution profiles. |
| Top Institutional Relationships | Ranked relationship list. | Shows top allocator rows, ranked by deal activity in the loaded allocator packet. | Allocator activity, 30 days. | Active Allocators page. |
| Research & Analytics Hub | Image-backed intelligence cards. | Shows recent intelligence/news records as research cards. | Intelligence news packet. | Intelligence page. |
| Market Intelligence | Compact sector count list. | Shows top sector-flow names and counts. | Sector flows. | Deals page. |
| Deal Intelligence | Donut gauge plus top deals. | Shows the largest sector share in the loaded sector activity, then highlights the largest recent disclosed deal and the next largest deals. | Recent transactions and sector flows. | Deals page. |
| Upcoming Events & Engagements | Image-backed engagement cards. | Shows top live opportunity/RFP rows with institution and deadline/date context. | Live opportunities. | Mandates/RFPs page. |
| Activity Feed | Mixed recent-event list. | Combines recent deal updates, mandate posts, and research/news publications. | Recent transactions, live opportunities, intelligence news. | Intelligence page. |

## Editorial And Activity Modules

| Module | Meaning | Behavior |
| --- | --- | --- |
| Latest Intelligence | Editorial-style lead story, side stories, and secondary story cards. | Tabs switch between Latest Intelligence, Most Referenced, and Topics. Records link into the mapped research/intelligence route. |
| Upcoming Events rail | Small right-rail shortcut into events coverage/search. | Links to a search for Events. |
| Market Focus rail | Tags built from current sector-flow rows. | Each tag links into search for that market theme. |
| Recent Activity | Five current items by category. | Tabs: Transactions, RFPs, Opportunities, People. Each row is meant to continue into the corresponding SWFI record workflow. |
| Top 10 | Compact ranked analytical list. | Tabs: Compass Investment Types and SWF Buys by Sector. Ranking bars are normalized against the largest visible row. |
| Latest News & Intelligence ticker | Bottom ticker of the latest intelligence titles. | Shows up to six current intelligence/news rows and links to their research records. |

## Global Search Modal

| Element | Meaning | Behavior |
| --- | --- | --- |
| Search input | Cross-dashboard search entry. | Queries live public search after two or more characters and also searches the loaded dashboard rows. |
| Category filters | Narrow visible search results. | Categories: All, Entities, RFPs & Opportunities, Transactions, News & Articles, People. |
| Result groups | Top matching rows per category. | Each group is capped at five results in the modal. Ranking is business-relevance based, not alphabetical. |
| View all results | Opens the full search page. | Uses the same business-relevance ordering as autocomplete. |
| Keyboard controls | Fast navigation. | Up/down moves through results, Enter opens, Escape closes. |

## Link Behavior

| Link type | Behavior |
| --- | --- |
| Internal app path | Routed through the dashboard app path helper. |
| Canonical SWFI record URL | Routed through the SWFI auth handoff helper so SWFI's existing authentication can protect the destination. |
| Source/provenance URL on a row | Kept as the row's detail/source state and used by record-aware links. |

## Access Boundary

The dashboard is a public preview surface. It should show enough top-level information to create useful discovery, but not enough to become a replacement for SWFI's protected platform.

Deeper navigation should use SWFI's existing authentication and forwarding behavior:

- public visitor opens dashboard,
- public visitor clicks a deeper row, chart, or record link,
- SWFI login handles authentication when required,
- authenticated user lands on the intended SWFI platform page.

This is the Phase 1 model. The dashboard should not add custom auth, subscriber state, watchlists, alerts, or personalized protected content unless a later requirement explicitly changes that.

## Do Not Infer

- A green dashboard render is not full-universe parity proof.
- A KPI card is only as trustworthy as its source packet and freshness receipt.
- The sidebar Watchlist is a dashboard top-AUM list, not a user-personal watchlist unless that backend feature is explicitly added.
- AI Insights is a source-row synthesis panel. It should not be presented as unsupported prediction or generated fact.
- Any chart that falls back because a field is missing must be treated as a dashboard fallback, not as a verified SWFI analytic definition.
- The dashboard is not meant to expose the entire database. Tables and lists should be curated analytical previews unless the accepted requirements explicitly define a deeper workflow.

## Validation Receipts To Pair With This Page

- Data parity receipt: proves values and rankings match the approved SWFI source.
- Route parity receipt: proves clickable rows reach the expected SWFI destination.
- Freshness receipt: proves each data packet is current enough to display.
- Visual receipt: proves the dashboard renders without broken layout, overlap, or blocked controls.
- Leakage sweep receipt: proves no internal IDs, source-gap language, Active Mirror wording, debug labels, or backend diagnostics appear on user-facing dashboard surfaces.
