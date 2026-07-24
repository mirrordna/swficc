# SWFI Workflow-To-Data Matrix

Source doctrines:
- `/Users/mirror-pro/Downloads/SWFI Platform Deck.pdf`
- `/Users/mirror-pro/repos/swfi-dashboard/docs/doctrine/SWFI_PLATFORM_DECK_DOCTRINE.md`
- `/Users/mirror-pro/repos/SWFI2.0-final/config/source-contracts.json`
- `/Users/mirror-pro/repos/SWFI2.0-final/docs/DATA_SOURCES.md`

Rule: wire only real source-backed endpoints. If no verified endpoint exists, the product must render source gap / not disclosed.

| Deck workflow | Expected user capability | Real endpoint now | Source collection | Current product route | Status |
|---|---|---|---|---|---|
| Dashboard overview | Single-page overview of platform data | `/api/swfi/dashboard-metrics/v1` plus insight endpoints | `swfi_api.entities.search`, `swfi_mongo.entities`, `swfi_api.transactions`, `swfi_api.compass` | `/swficc/` | Live |
| Today's News | View news title/date/source and open source detail | `/api/source-intelligence/news/v1` | `swfi_api.news.search` | `/swficc/research/` and `/swficc/source/` | Live |
| Newest Transaction | View newest transactions and open transaction detail | `/api/recent-transactions/v1`; `/api/deal-intelligence/v1?q=` for selected title | `swfi_api.transactions` | `/swficc/transactions/`, `/swficc/transactions/detail/` | Live, no direct by-id backend yet |
| New RFP and OPP | View current RFPs/opportunities and open Compass detail | `/api/live-opportunities/v1`; `/api/live-rfps/v1`; `/api/live-mandates/v1` | `swfi_api.compass` | `/swficc/mandates/`, `/swficc/mandates/detail/` | Live |
| Top 10 Most SWF Buys by Sector | Sector activity/count/capital from transactions | `/api/sector-flows/v1`; `/api/transaction-drilldown/v1?field=sector&value=` | `swfi_api.transactions` | `/swficc/reports/#investment-trend-analytics`, `/swficc/transactions/` | Live derived |
| Transactions By Investment Type | Investment-type transaction grouping | `/api/transaction-drilldown/v1?field=investment_type&value=` | `swfi_api.transactions` | `/swficc/transactions/`, reports | Live derived when field values are known |
| Alerts setup | Configure alert criteria | None verified for save/delivery | Pending alert subscriptions/receipts | `/swficc/alerts/` | Source gap for delivery/save |
| News page | Search/browse news | `/api/source-intelligence/news/v1` | `swfi_api.news.search` | `/swficc/research/` | Live |
| Events | Upcoming events cards/details | No verified endpoint in source contracts | None | Not first-class route | Source gap |
| Quarterly Reports | Browse/open reports | `/api/source-data/search/v1?collection=reports` is blocked | `swfi_api.reports.search` unproven | `/swficc/reports/` | Source gap |
| Entities | Entity directory, count, detail/profile | `/v1/swfi/top20`; `/api/v1/public/search`; `/api/profiles/{slug}/v1` | `swfi_api.entities.search.assets`, `swfi_api.entities.aum` | `/swficc/profiles/`, `/swficc/profiles/detail/` | Live for SWF slice/profile AUM |
| Search | Search institutions/people/strategy | `/api/v1/public/search`; `/api/source-data/search/v1?collection=people`; `/api/transaction-drilldown/v1` | `swfi_api.entities.search.assets`, `swfi_api.people.search`, `swfi_api.transactions` | `/swficc/search/` | Live by source lane |
| Search filters | Filter/sort/count result tables | Frontend controls over real packets; server paging where available | Depends endpoint | all list pages | Live where table-like |
| Profile overview | Entity facts, source links, AUM | `/api/profiles/{slug}/v1` | `swfi_api.entities.search.assets`, `swfi_api.entities.aum` | `/swficc/profiles/detail/` | Live when slug/search resolves |
| Profile related sections | Overview/assets/people/documents source anchors | SWFI source URL anchors retained in source detail | SWFI entity source route | `/swficc/profiles/detail/`, `/swficc/source/` | Source-link live; section data partial |
| Asset allocation and transactions | AUM history and related transactions | `/api/profiles/{slug}/v1`; transaction endpoints | `swfi_api.entities.aum`, `swfi_api.transactions` | profiles detail, transactions | Partial live |
| People data | People directory/search | `/api/source-data/search/v1?collection=people` | `swfi_api.people.search` | `/swficc/people/` | Live directory; leadership changes blocked |
| Person detail | Person identity/role/org/source | No dedicated person detail endpoint verified | `swfi_api.people.search` only | `/swficc/people/` | Source gap for full detail |
| Transaction directory | Transaction list/search/sort/filter | `/api/recent-transactions/v1`; `/api/deal-intelligence/v1?q=` | `swfi_api.transactions` | `/swficc/transactions/` | Live |
| Transaction details | Selected transaction metadata/source | `/api/deal-intelligence/v1?q=` or recent transaction match | `swfi_api.transactions` | `/swficc/transactions/detail/` | Live when endpoint returns selected row; no direct by-id backend yet |
| League tables | Ranked tables/counts | No dedicated league-table endpoint verified | None | Reports only | Source gap |
| Submit transaction | Submission form | No verified submission endpoint | None | Not first-class route | Source gap/no fake submit |
| Compass | Opportunity/RFP/mandate totals and rows | `/api/live-opportunities/v1` | `swfi_api.compass` | `/swficc/mandates/`, `/swficc/mandates/detail/` | Live |
| RFP filters | Filter RFP/opportunities | `/api/live-opportunities/v1` plus frontend filters | `swfi_api.compass` | `/swficc/mandates/` | Live basic filter |
| Submit RFP/opportunity | Submission form | No verified submission endpoint | None | Not first-class route | Source gap/no fake submit |
| Member logos | Brand proof only | No product data endpoint | None | Not product fact | Do not treat as fact |

## Immediate Build Rules

- Prefer detail routes over filtered list loops:
  - `/swficc/profiles/detail/?slug=...`
  - `/swficc/transactions/detail/?id=...&title=...`
  - `/swficc/mandates/detail/?id=...&title=...`
- Keep canonical SWFI URLs in `data-source-href` and `/swficc/source/`.
- Do not add Events, League Tables, Alerts delivery, Submit Transaction, or Submit RFP as working claims until verified endpoints exist.
