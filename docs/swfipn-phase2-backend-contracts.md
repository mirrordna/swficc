# SWFIPN Phase 2 Backend Contracts

Status: acceptance-test candidate
Surface: `/swficc`
Public dashboard: `https://swfipn.activemirror.ai/swficc/`
Backend origin used by the public surface: `https://swfipn.activemirror.ai`

## Non-Negotiables

- No fake data.
- No inferred fallback values.
- No frontend MongoDB access.
- Server-side data only.
- Whitelisted public fields only.
- No object IDs, internal diagnostics, Active Mirror labels, `source_gap` text, API names, or backend status exposed in user-facing UI.
- Every dashboard value must come from an approved backend record or be hidden.
- Every displayed datum must have an internal audit receipt.
- Public UI may link users into SWFI auth where required, but backend correctness must not depend on browser-side scraping.

## Canonical Collections

| Record Class | Canonical Collection(s) | Notes |
| --- | --- | --- |
| Institutions / entities | `swfi.entities`, `swfi.entitiesAUM` | Entity profile and AUM ranking data. |
| People | `swfi.people` | People source rows and person details. |
| Transactions / deals | `swfi.transactions` | Transaction, deal, sector-flow, and active-allocator source rows. |
| Compass / RFPs / mandates | `swfi.compass` | Live RFP/opportunity rows and Compass detail records. |
| News / intelligence | `swfi.news`, `swfi.cms_articles` | Intelligence feed and research detail source rows. |
| Reports | `swfi.reports` | Source-backed report list, detail records, and report asset URLs. |

## Module Contracts

| Module | Endpoint | Source Collection(s) | Sort | Pagination | Required Freshness Receipt |
| --- | --- | --- | --- | --- | --- |
| Dashboard Metrics | `/api/swfi/dashboard-metrics/v1` | `swfi.entities`, `swfi.transactions`, `swfi.compass` | None | None | Packet `generated_at`; card values must be factual. |
| Top Active Allocators | `/api/allocator-activity/v1?days=90&limit=25&page=1&sort=deal_count&direction=desc` | `swfi.transactions`, `swfi.entities`, `swfi.entitiesAUM` | `deal_count desc`, `total_deal_value desc`, `latest_transaction_date desc` | `limit`, `page` | Packet `generated_at`, allocator source URL, sampled deal source URLs. |
| Newest Transactions | `/api/recent-transactions/v1?days=90&limit=25&page=1` | `swfi.transactions` | transaction activity date descending | `limit`, `page` | Packet `generated_at`, transaction source URL. |
| Recent Deals | `/api/recent-transactions/v1?days=30&limit=25&page=1` | `swfi.transactions` | transaction activity date descending | `limit`, `page` | Packet `generated_at`, transaction source URL. |
| RFP Opportunities | `/api/live-opportunities/v1?limit=25&page=1` | `swfi.compass` | `deadline asc`, then `posted_at desc` | `limit`, `page` | Packet `generated_at`, Compass source URL. |
| Market Activity | `/api/sector-flows/v1?days=365` | `swfi.transactions` | `count desc`, then disclosed capital | None | Packet `generated_at`, transaction facet basis. |
| Institution List | `/api/source-data/search/v1?collection=entities&limit=25&page=1` | `swfi.entities`, `swfi.entitiesAUM` | name/AUM/country/region/type where supported | `limit`, `page` | Packet `generated_at`, entity source URL. |
| People List | `/api/source-data/search/v1?collection=people&limit=25&page=1` | `swfi.people` | name/institution/country/region where supported | `limit`, `page` | Packet `generated_at`, people source URL. |
| News / Intelligence | `/api/source-intelligence/news/v1?limit=25&page=1` | `swfi.news`, `swfi.cms_articles` | `published_at desc`, `updated_at desc`, or source order | `limit`, `page` | Packet `generated_at`, legacy/source identifier. |
| Reports | `/api/reports/v1?limit=25&page=1` | `swfi.reports` | `published_at desc`, `updated_at desc`, title/type where supported | `limit`, `page` | Packet `generated_at`, report key, and `assets.swfi.com/reports/*.pdf` asset URL. |

## Active Allocators Formula

Approved Phase 2 formula:

1. Use completed transactions inside the selected date range only.
2. Count buyer/acquirer side only.
3. Exclude invalid or unverified records.
4. Group by buyer/acquirer entity.
5. Sort by:
   - number of deals descending
   - total disclosed deal value descending
   - most recent transaction date descending
6. Public row fields:
   - Entity Name
   - Entity Type
   - Country
   - Region
   - Number of Deals
   - Total Deal Value
   - Last Transaction Date
   - AUM

KP comparison:

- `ActiveAllocators.java` ranks entities by recent AUM / managed-assets update timestamps. That is not the approved Phase 2 formula.
- `TopActiveInvestors.java` is closer because it counts transaction and Compass activity by institution, but Phase 2 is stricter: completed transactions only, buyer/acquirer side only, and the sort order includes total disclosed deal value before latest date.

## Detail Resolution Contracts

| Source Row | Backend Detail Endpoint | Acceptance Rule |
| --- | --- | --- |
| Entity row | `/api/profiles/{id}/v1` | Returns factual profile packet for the same SWFI entity source URL. |
| Person row | `/api/people/{id}/v1` | Returns factual person packet for the same SWFI people source URL. |
| Transaction row | `/api/transactions/{id}/v1` | Returns factual transaction packet for the same SWFI transaction source URL. |
| Compass/RFP row | `/api/compass/{id}/v1` | Returns factual Compass/RFP packet for the same SWFI Compass source URL. |
| Intelligence row | `/api/source-intelligence/news/v1?legacy={legacy_post}&limit=1` | Returns factual article packet for the same legacy source identifier. |
| Report row | `/api/reports/{report_key}/v1` | Returns factual report packet for the same report key and report asset URL. |

## Fail-Closed Rules

- If a packet is not factual, the module fails acceptance.
- If `generated_at` is missing, invalid, or stale beyond the configured acceptance window, the module fails acceptance.
- If a required source URL or legacy identifier is missing, the row fails acceptance.
- If a visible public route exposes internal diagnostics, the UI fails acceptance.
- If a list page cannot page beyond page one when total count exceeds the limit, the list fails acceptance.
- If sorting is not numeric/date-aware, the module fails acceptance.

## Evidence Command

```bash
SWFIPN_ORIGIN=https://swfipn.activemirror.ai/swficc/ \
SWFIPN_BACKEND_ORIGIN=https://swfipn.activemirror.ai \
npm run phase2:backend:acceptance
```

Output:

```text
output/swfipn-phase2-backend-acceptance-latest.json
```
