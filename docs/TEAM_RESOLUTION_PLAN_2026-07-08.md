# Resolution & Plan — dashboard.swfi.com (2026-07-08)

For Dipika's three asks: a working institutional platform, premium quality,
latest news and data — with a twice-daily reporting cadence. Written the day
KP's "Dashboard 2.0: Key Principles v1.0" arrived; those principles were
implemented and turned into an automated gate the same day.

## Where the product stands tonight (receipts on file)

LIVE now (build `20260708T103554Z`, git-clean, verified by fetch today):
- Public dashboard with no login wall; every record chain ends at the
  SWFI platform sign-in with the intended record preserved.
- The analytics layer on every list page: rankings, quick counts,
  category-by-geography heatmap, computed insights, "new & updated in this
  view" freshness strip, optional focus lens.
- Global search fixed for the team's named cases (PIF, Abu Dhabi, Zurich —
  re-verified live today), entity-to-transactions join, sidebar reads
  "Dashboard Navigation".

COMMITTED, ships next deploy cycle (receipts in the repo):
- Limited-preview pager (4 pages, then "Continue on SWFI" sign-in) — P02/P03.
- Every element carries a call to action; no public data downloads anywhere —
  exports hand to SWFI sign-in on every surface — P04/P05.
- The Dashboard 2.0 E2E Contract gate: every element must declare purpose,
  source, CTA, and destination; failure reasons per element, not a bare 200.
- Premium identity pass: engraved-registry typography for headline figures
  and a guilloché signature band under the header (state-money vernacular,
  SWFI crimson and navy untouched).

## The "latest news and data" answer

- Checked today: the public news feed serves current stories and the packet
  is generated same-day, BUT each article's `published_at` arrives EMPTY in
  the payload, so the dashboard cannot display story dates. Freshness cannot
  be proven on screen until that field is populated.
- Fix owner: backend (populate `published_at` on
  `/api/source-intelligence/news/v1`). The frontend already renders dates
  wherever they exist, and the freshness strip / "Most recent" rankings
  activate automatically once dates arrive.
- Data currency elsewhere: allocator activity, transactions, and mandates
  carry dates today and rank by recency; every module's scope is stated on
  its face.

## Twice-daily cadence (proposal)

Morning call (10:00 IST) and evening call (18:00 IST), each backed by a
five-line written report in the same order every time:
1. Shipped since last call (with receipts)
2. Live verification (what was checked on dashboard.swfi.com itself)
3. Next (the one or two items in flight)
4. Blockers (named, with owner)
5. Decisions needed from the team

## Decisions the team owes (one line each)

Browse-depth final ruling (preview cap number), League Tables keep/drop,
Jaykesh's hierarchy + filter lists, icons choice, "engaged" definition,
comparison exceptions, social-footer links, official reference environment,
and triage of the contract gate's first discovery run.

## Workstreams and owners

1. Backend data currency (published_at, AUM history series) — backend lane.
2. Deploy + full gate suite from current branch HEAD, then the contract
   gate's first run — Codex lane (sequencing note already handed off).
3. Principle gaps from Premjit/Jaykesh's evaluation — triaged into the
   contract gate so every gap becomes a named, testable failure reason.
