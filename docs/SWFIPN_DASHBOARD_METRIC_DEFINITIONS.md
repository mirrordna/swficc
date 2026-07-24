# SWFIPN Dashboard Metric Definitions

Status: dashboard cleanup contract
Surface: `/swficc`
Rule: no dashboard metric may be displayed unless it is backed by an approved SWFI packet or clearly unavailable.

## Feedback Applicability

The June/July dashboard feedback used the former Total AUM Engagement section as a concrete example only. The observations are representative, not section-specific.

This standard applies across the whole dashboard:

- Every module must present meaningful business insight, not raw database exposure.
- Direct database tables with basic row-count pagination are not a dashboard experience and should not appear as the primary presentation of any dashboard module.
- Every module should use truthful visuals, rankings, comparisons, maps, charts, or other analytical summaries where the source data supports them.
- Every dashboard-originated record click must route to the correct SWFI platform/auth destination when a canonical SWFI record URL or id exists.
- Internal implementation language must not appear on user-facing dashboard surfaces.
- A defect found in one dashboard section must be checked for the same defect pattern across all dashboard sections.
- Fixes should be applied at the shared component, data mapper, metric contract, or route helper level when the same issue can recur elsewhere.

## Dashboard Mantra

Dashboard modules should strive to:

1. Provide rich visualization of data through charts, heatmaps, maps, ranking bars, cards, and compact visual summaries.
2. Provide additional insights beyond raw database exposure.
3. Bring related information from multiple SWFI packets into one cohesive view.

Tables are allowed only when they are high-value analytical views, such as AUM rankings, growth rankings, profitability rankings, most active allocators, top investors by region/country, or rankings by investment sector/geography. Simply exposing database rows in a table with basic pagination is not a meaningful dashboard experience, especially when SWFI's existing platform already provides record browsing.

## Single Source of Truth

Dashboard navigation must ultimately lead users back to SWFI's core platform data when a record is being opened.

- Do not recreate SWFI institutional entity, person, transaction, Compass/RFP, or research record assets in parallel from dashboard-originated clicks.
- When a row has a canonical SWFI `/v1` record URL or SWFI record id, the dashboard link must open the SWFI platform/auth destination for that record.
- Local dashboard routes are allowed for discovery, charts, filters, rankings, comparisons, and expanded analytical views. They are not replacements for the existing SWFI profile/detail assets.
- If a dashboard row does not have a verified SWFI record URL or id, link to dashboard search/discovery for that label rather than pretending a parallel detail page exists.

## Definitions

| Metric | Useful Because | Source Packet | Definition | Window | Sort / Display | Hide When |
| --- | --- | --- | --- | --- | --- | --- |
| Institutions Tracked | Shows platform coverage without exposing raw records. | `/api/swfi/dashboard-metrics/v1` | Count of approved SWFI institution/entity records returned by the backend metrics packet. | Current packet | Integer count | Packet is missing, stale, or not factual. |
| Institution Coverage by Entity Type | Replaces raw institution tables with a coverage distribution view. | `/api/institution-types/v1?limit=8` | Group approved SWFI entity records by normalized entity type from `type`, `entity_type`, or `entityType`. | Current packet | Count desc; horizontal distribution bars. | Aggregate packet is missing, stale, or not factual. |
| Top AUM Ranking | Gives capital scale for the approved top-AUM ranking without pretending to know undisclosed values. | `/v1/swfi/top20?limit=25` or approved AUM ranking endpoint | Use the backend-supplied `total_assets`, `total_aum`, or `aum_total` when present. Otherwise sum loaded ranked AUM rows only when all included rows disclose the same currency. This is not a universe-wide total unless the backend supplies that explicit field and basis. | Current ranked packet | Compact value plus trend sparkline from ranked rows. Add a currency symbol only when the packet supplies an explicit currency for the total or all included rows share one currency. | Total is missing, rows are mixed/missing currency, or AUM is not disclosed. |
| Top Active Investors | Answers who is currently investing, not who had stale historical activity. | `/api/allocator-activity/v1?days=30&limit=25&page=1&sort=deal_count&direction=desc` | Completed transactions inside the selected date range, grouped by buyer/acquirer entity only. | Default 30 days for the dashboard overview. | Deal count desc, total disclosed deal value desc, latest transaction date desc. | Transaction date, buyer/acquirer, or verification state is missing. |
| Active Allocators Count | Shows broader current allocator activity. | `/api/allocator-activity/v1?days=90&limit=1&count_only=1` | Count of entities with completed buyer/acquirer-side transaction activity in the selected period. | Default 90 days. | Compact integer in KPI rail. | Count packet is missing, stale, or not factual. |
| Disclosed Deal Value | Shows real transaction scale while respecting undisclosed amounts. | `/api/sector-flows/v1?days=365` and `/api/recent-transactions/v1` | Sum of disclosed transaction amounts in the returned packet, grouped by industry/category when used in visuals. | Default 365 days for sector flow; 30 or 90 days for recent deals. | Currency-aware value when normalized by source; otherwise display row amount as disclosed. | Amount is undisclosed or currency basis is not comparable. |
| Live RFPs / Mandates | Shows actionable fundraising opportunities. | `/api/live-opportunities/v1?limit=25&page=1` | Open Compass opportunity/RFP/mandate rows with deadline on or after current date. | Current packet | Deadline asc, posted date desc. | Deadline is expired or status is not open/live. |
| Recently Fundraising Institutions | Connects RFP activity back to institutions. | `/api/live-opportunities/v1?limit=25&page=1` | Institutions attached to live Compass/RFP rows. | Current packet | Deadline asc, institution name. | Institution or live RFP record is missing. |
| Market Activity by Industry / Category | Converts transaction rows into an interpretable market view. | `/api/sector-flows/v1?days=365` | Transaction count and disclosed capital grouped by normalized industry/category fields. | Default 365 days | Count desc, disclosed capital desc. | Category is missing or the packet is not factual. |
| Recent Deals / Newest Transactions | Lets users inspect the newest transaction records directly. | `/api/recent-transactions/v1?days=30&limit=25&page=1` | Transaction rows ordered by transaction activity date. | Default 30 days | Date desc; amount sort must parse K/M/B/T and currency strings numerically. | Activity date or transaction record is missing. |
| Intelligence Items | Keeps the dashboard current without generated headlines. | `/api/source-intelligence/news/v1?limit=25&page=1` | SWFI article/intelligence rows with title and SWFI URL or legacy article id. | Current packet | Published date desc, then source order. | Title or source identifier is missing. |
| Discovery Funnel | Helps users understand coverage by module without claiming a sales pipeline. | Dashboard metrics plus module packets | Counts of records available in the displayed dashboard modules: institutions, active allocators, deals, live RFPs, and ranked AUM rows. | Current displayed packets | Count bars normalized to largest displayed count. | Any stage lacks a factual packet. |

## Visual Rules

- Charts must be direct transformations of the packets above.
- Summary dashboard modules should use visual cards, maps, charts, heatmaps, or ranking bars by default.
- Table format should be reserved for expanded analytical detail, rankings, filtering, sorting, or export workflows.
- Do not make basic row pagination the main dashboard interaction for a module.
- Do not generate synthetic time series from a single current packet.
- Do not assign sector values to geographic regions.
- Do not sum AUM across mixed or missing currencies.
- Do not add a currency symbol to Total AUM Engaged unless the source packet supplies an explicit currency for the total or all included rows share one currency.
- Do not replace missing AUM with unrelated counts.
- Do not show internal labels such as backend names, object ids, source gaps, debug states, model labels, or implementation terminology.
- Links from dashboard rows should open the corresponding SWFI platform/auth destination when a SWFI record URL is known; otherwise they should stay in discovery/search until the record mapping exists.

## Useful Next Metric Contracts

These are useful but should not be shown until the backend exposes factual packets:

| Candidate Metric | Required Backend Contract |
| --- | --- |
| True Total AUM | Universe-wide disclosed AUM total with currency, as-of date, and inclusion/exclusion rules. |
| AUM Change Over Time | Historical AUM rows by entity/date/currency, not generated from the current top-AUM list. |
| Net Capital Flow | Buy/sell or inflow/outflow classification per transaction with comparable currency basis. |
| Regional Deal Flow | Transaction rows with disclosed buyer/seller region, date, amount, and comparable currency. |
| Investment Destination Map | Transaction and/or holdings rows that identify investor type, buyer/acquirer, destination company/fund/asset, destination country/region, industry/category, amount, date, and source URL. |
| Co-Investment Network | Transaction rows with multiple disclosed buyers/acquirers or sponsor/co-investor fields, plus entity-resolution ids for each participant. |
| Manager Relationships | Mandate, allocation, fund, or transaction rows that explicitly connect asset owners to managers/sponsors; do not infer a relationship from article text alone. |
| Portfolio / Holdings Exposure | Holdings or portfolio rows by institution/security/fund/asset with date, value, currency, and source document. Transaction history alone is not full portfolio exposure. |
| Engagement Score | Explicit product-approved scoring formula using only approved data fields. |
