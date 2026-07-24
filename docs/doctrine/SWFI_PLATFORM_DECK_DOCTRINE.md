# SWFI Platform Deck Doctrine

Source: `/Users/mirror-pro/Downloads/SWFI Platform Deck.pdf`

Extraction date: 2026-06-13

Notes:
- The PDF has 28 pages and no usable text layer from `pdftotext`.
- This checklist is derived from rendered page review.
- Do not treat slide screenshots as fresh facts. Use them as workflow doctrine only.
- All data values in the product must still come from authenticated SWFI.com production API packets or render as source gap / not disclosed.

## Page-by-Page Product Requirements

1. Cover
   - Establish SWFI as the institutional investor/global capital platform.
   - Product should present a sober SWFI-branded terminal, not a generic marketing page.

2. About the Platform: SWFI
   - Explain the platform as a subscriber-facing institutional investor research/workflow system.
   - Product must orient users around institutional profiles, transactions, RFPs/opportunities, news, reports, and alerts.

3. Dashboard
   - Single-page overview.
   - Must expose these modules as reachable workflows:
     - Today's News
     - Newest Transaction
     - New RFP and OPP
     - Top 10 Most SWF Buys by Sector
     - Transactions By Investment Type

4. Today's News / Newest Transaction
   - News list must show title and date.
   - Newest transaction list must show transaction name and amount.
   - Each row should open an internal SWFIPN detail/source route, not dump the user back on the same list.

5. Newest RFPs and Opportunities / Transactions By Investment Type
   - RFP/opportunity list must show name, type, and amount where SWFI provides it.
   - Transactions by investment type must show investment type, amount, and count.
   - Rows must be sortable/filterable where table-like.

6. Set Up Alerts and Notifications
   - Alerts must support managing transaction alert settings.
   - The workflow should expose alert criteria fields and an action to save/update.
   - If delivery is not wired, render a source gap/status rather than pretending delivery works.

7. News
   - News page must offer searchable/browsable news cards/list.
   - News rows need title, source/date metadata where available, and SWFI source detail.

8. Events
   - Events page/module must list upcoming events.
   - Cards should show event title/date and link to an internal detail/source route where available.

9. Quarterly Reports
   - Reports page must list quarterly reports and allow opening the report asset/detail.
   - Do not collapse report links to the generic `/reports/` top page.

10. Entities
   - Entities page must show entity count and a tabular/list directory.
   - Each entity row must open an entity-specific internal profile/source view.
   - Search/filter/sort are required for directory behavior.

11. Search
   - Search page must expose a visible search input and results table.
   - Results must preserve the result type and source route.

12. Add a Filter
   - Search/list pages must support filters.
   - Filter UI must alter visible results and show filtered counts.

13. Profile View: Overview
   - Profile view must expose entity details, summary, and contact/metadata sections where source-backed.
   - Entity name links must not loop back to `/profiles/`; they must resolve to a selected profile/source state.

14. Profile View: Related Data
   - Profile view must expose related tabs/sections such as assets, people/managers, documents, transactions, or comparable source sections when available.
   - Section links should map to source-detail anchors such as overview/assets/managers/documents when SWFI uses those anchors.

15. Asset Allocation and Transactions
   - Entity/profile workflow must show asset allocation and transaction history where SWFI provides source packets.
   - Charts/tables must cite the SWFI source packet.

16. Search and Add a Filter
   - Transaction/entity search pages must allow adding filters and narrowing results.
   - Counts must show visible rows vs total/source count.

17. Search and Add a Filter
   - Advanced filter workflows should support multiple fields, not just one text input, when the backend exposes those fields.
   - If a field is not backed by source data, show source gap.

18. People Data
   - People page must expose people count/directory/search.
   - Must support search by name and filtered person rows.

19. Sample: People Data
   - Person detail workflow must show person identity, title/role, organization, and related profile/source links where source-backed.

20. Transactions
   - Transactions page must show a searchable transaction directory.
   - Required row concepts: transaction name, buyer/entity, seller/entity where available, amount, date, and source.

21. Transaction Details
   - Transaction detail/source workflow must show transaction metadata and narrative/details where SWFI provides them.
   - Deal row clicks must open an internal filtered/detail/source route, not redirect to SWFI.com directly.

22. League Tables
   - League-table workflow must show ranked tables and counts.
   - Tables need sort/filter/counts and source provenance.

23. Submit a Transaction to SWFI
   - Must provide a transaction submission form workflow.
   - If submission endpoint is not active, render inactive/source-gap status and do not fake submission.

24. Compass
   - Compass workflow must expose opportunities/mandates/RFPs with totals and source-backed rows.
   - Compass rows should link to internal source detail for `/v1/compass/{id}`.

25. Search the RFP by Following Filters
   - RFP/opportunity search must support filters such as type/category/status/region where source-backed.
   - Filtered result counts are required.

26. Submit an RFP or Opportunity
   - Must provide an RFP/opportunity submission workflow.
   - If submission endpoint is not active, render inactive/source-gap status and do not fake submission.

27. Advantages of SWFI Platform
   - Product should demonstrate advantages through working workflows, not generic claims.
   - Claims must be backed by working routes, counts, source detail, and traceable SWFI provenance.

28. Select SWFI Members
   - Member/customer proof is brand/context only unless current approved data exists.
   - Do not use member logos as product facts unless allowed by source/approval.

## Route Contract

- Dashboard intelligence links must not all point to `/reports/`.
- Dashboard intelligence links must target exact report anchors:
  - Historical Performance: `/swficc/reports/#historical-performance-dashboard`
  - Peer Comparison: `/swficc/reports/#peer-comparison-engine`
  - Rankings: `/swficc/reports/#dynamic-rankings-engine`
  - Trend Analytics: `/swficc/reports/#investment-trend-analytics`
  - Co-Investment: `/swficc/reports/#co-investment-tracking`
  - Deal Intelligence: `/swficc/reports/#deal-and-transaction-intelligence`
- Profile/entity links must target `/swficc/profiles/?filter={entityName}` or a future entity-specific internal route, with SWFI.com entity URL retained as provenance.
- Transaction links must target `/swficc/transactions/?filter={transactionName}` or a future transaction-specific internal route, with SWFI.com transaction URL retained as provenance.
- Compass/RFP links must target `/swficc/mandates/?filter={title}` or a future Compass detail route, with SWFI.com Compass URL retained as provenance.
- SWFI.com direct URLs are source truth, not primary user navigation, unless authenticated external handoff is explicitly required.

## QA Gate

For every route above:
- HTTP 200 is not enough.
- Verify visible content, row counts, sort/filter, click target, source provenance, and no self-loop.
- If a feature is shown in the deck but not source-backed, render source gap/not disclosed rather than seed/demo values.
