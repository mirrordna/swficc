# Change notes — dashboard.swfi.com — 2026-07-05

Per meeting minutes 2026-07-03, action 17: for each fix, what changed and
what to test. Written for the team, in plain language. Items marked LIVE are
on dashboard.swfi.com now; items marked READY are committed and waiting on
the next deploy.

## LIVE (release 20260705T113155Z, deployed 2026-07-05 ~17:02 IST)

1. "TOTAL AUM ENGAGED" is gone (minutes H / action 8). The KPI is now
   "TOP-RANKED AUM TOTAL"; the sidebar card is "TOP 5 BY AUM".
   Test: load the dashboard — the phrase should appear nowhere.
2. Peer comparisons only compare like with like (minutes I / action 10).
   Test: open Comparisons — the header states the peer group and every
   column should be the same entity type.
3. No invented visuals: sparklines no longer draw fake flat lines with no
   data; the AUM card no longer draws a fake "downtrend" (it was ranking
   values, not a time series).
4. Currency-honest numbers: totals only display when a single currency backs
   them. The old 16.9T was a sum across 12 different currencies — it never
   meant anything. Watchlist shows compact values (NOK 2T, not
   NOK 2,048,995,080,000). The map's top country corrected to Norway.
5. Search works (minutes E / action 2 — the top priority): PIF, Abu Dhabi,
   Zurich Insurance Group all return the right institution first.
   Test: use the search box with those three queries.

## READY — committed, not yet deployed (commits 8cbe685 + 3ca90dd)

6. AUM is back as a real number (Paul's directive): an explicitly-USD total
   computed from the verified USD field, with USD-normalized ranking.
   Test after deploy: the AUM KPI shows a $ figure again with a tooltip
   explaining exactly what it is.
7. "Loading…" instead of "Not disclosed" while data fetches.
8. Every panel carries a one-line explanation of what it shows and where
   clicks go; every KPI card has an explanatory tooltip (minutes F).
9. Investment Strategy row in Peer Comparisons (minutes K — KP's ask).
10. Detailed record views forward to the SWFI platform (minutes J): the six
    in-app detail pages now redirect to the swfi.com record via login
    handoff. The dashboard stays a curated preview (minutes D).
11. Map bubbles are labeled with country + same-currency AUM (minutes F).
12. Sidebar navigation: one truthful label per page; "Deals & Pipelines" →
    the transactions list (the KP contract mapping); Active Allocators and
    Peer Comparisons added; the RFP page is no longer labeled "Events &
    Forums".
13. Stable SWFI logo in the page header on all screen sizes.
14. List-page charts are titled "(current page)" so a 25-row slice is never
    mistaken for the whole universe; the misleading 3-dot "Records by Month"
    line is suppressed when there isn't enough dated data.

## Known open items

- Full-universe visual aggregates for the list pages (the "meaningful visual
  insight" direction from minutes D) — next engineering block.
- "Reports" vs "Intelligence": different surfaces — Reports is SWFI's
  published report documents (PDF doctrine page); Intelligence is the
  news/articles feed. An internal duplicate route (/research, same data as
  /intelligence) exists and can be consolidated on team sign-off.
- Team-owned: the definition of "engaged" if the term returns (action 8),
  Jaykesh's autocomplete hierarchy list (action 3), icon review (action 4),
  the high-impact requirements document (actions 11–13), KP's repo/backend
  access (actions 15–16).
