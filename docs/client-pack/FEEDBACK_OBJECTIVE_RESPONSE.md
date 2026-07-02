# Feedback Objective Response

Source feedback:

- `/Users/mirror-pro/.codex/attachments/cd55b111-d76c-4f2c-9941-462329606653/pasted-text.txt`
- `/Users/mirror-pro/Downloads/SWFI_Marketing_and_Design_Pack_v0/`

## Stage

Dashboard acceptance cleanup for the current `/swficc` validation release.

This is not a full Phase 2 product completion claim. The purpose of this pass is to make the dashboard clearer, more insight-led, less internal-facing, and easier for KP, Jaykesh, and Prem to validate.

## What Changed

- Simplified customer-facing wording across dashboard/search/list surfaces.
- Removed visible references to old internal-style labels such as `Smart Search Bar`, `SWFI-backed rows`, `SWFIPN record`, `Source on file`, and `Open in SWFI`.
- Renamed the raw-feeling dashboard activity section to `Recent Activity`.
- Limited dashboard activity cards to five visible items per category.
- Added date/action context to recent transactions, people, and RFP/activity rows.
- Tightened dashboard search copy to position search as relevance-ranked discovery.
- Added relevance scoring for dashboard search and search results, including stronger handling for institution-heavy queries such as Abu Dhabi.
- Simplified primary dashboard navigation toward the SWFI platform taxonomy: Dashboard, News, Institutions, People, Transactions, Compass, RFPs, Reports.
- Kept deeper analytical routes available through contextual modules instead of making the dashboard feel like a parallel platform.
- Added a receipt gate for this feedback pass: `npm run feedback:objective:gate:public`.

## Feedback Mapping

| Feedback Area | Current Response |
| --- | --- |
| Focus on dashboard improvement, not platform restructuring | This pass only changes dashboard/search/list presentation and gates. |
| Provide release summary with validation scope | This document is the summary; receipt is `output/swfipn-feedback-objective-gate-latest.json`. |
| Remove internal terms from customer pages | App copy and tooltips were cleaned; gate scans for the main forbidden terms. |
| Clean landing after login | Dashboard entry remains the primary experience; no internal proof language is introduced. |
| Dashboard vs command center confusion | Primary dashboard nav was simplified; command-center style wording is not used on the dashboard. |
| Hide Glass Box from standard users | No dashboard/customer component exposes Glass Box wording. |
| Sections need purpose and next action | Activity modules now use clearer labels, dates/actions, and row-level detail links. |
| Top Institutional Relationships unclear | The dashboard-facing nav no longer promotes an unclear top-level relationship module. |
| For You / Popular Topics logic unclear | Those labels are not used as dashboard defaults in this release. |
| Newest Data should be concise and structured | The section is now `Recent Activity`, capped to five visible cards with date/action context. |
| Smart Search relevance | Search copy and client ranking were tightened; full backend search-ranking parity still depends on backend/reference data quality. |
| Compass/RFP counts need verification | This remains receipt-backed through existing Compass/RFP gates, not manually claimed here. |
| Visualizations need labels and explanation | Existing visualization modules remain; this pass keeps the feedback objective focused on wording/presentation/search. |
| League Tables scope must be confirmed | League Tables are not elevated into the dashboard primary path in this pass. |
| Entity filters need stronger filtering | Existing list filters remain; deeper filter expansion is backend/product scope, not claimed complete here. |
| Avoid raw database dumps on dashboard | Dashboard modules are capped and framed as insight/activity surfaces; large lists remain in search/list pages. |

## What To Test

1. Open `https://swfipn.activemirror.ai/swficc/`.
2. Confirm the first dashboard view uses SWFI branding and does not show internal implementation terms.
3. Confirm the dashboard presents insight modules and not a raw database table as the default experience.
4. Expand/click dashboard sections and confirm they reveal useful data and next actions.
5. Search for `Abu Dhabi` and confirm results are presented as relevance-ranked discovery.
6. Open `https://swfipn.activemirror.ai/swficc/search/?q=Abu%20Dhabi` and confirm row labels read as normal product actions, not source/provenance/debug copy.
7. Check mobile dashboard load for clean top-level lookup behavior.

## Receipt

Run:

```bash
npm run feedback:objective:gate:public
```

Expected output:

- JSON receipt: `output/swfipn-feedback-objective-gate-latest.json`
- Desktop screenshot: `output/swfipn-feedback-objective-dashboard.png`
- Mobile screenshot: `output/swfipn-feedback-objective-mobile.png`

## Not Claimed By This Pass

- Full Phase 2 product acceptance.
- Full-universe record parity.
- Full backend search-ranking parity against the reference environment.
- New backend filters beyond the endpoints already available.
- Legal terms, subscriber personalization, watchlists, alerts, or custom auth.
