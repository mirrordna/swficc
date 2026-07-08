# Dashboard 2.0 — Key Principles v1.0 (team doc, 2026-07-08)

Source: "Dashboard 2.0 ---- Key Principles v1.0.pdf" (SWFI, received from Paul
2026-07-08). Transcribed here so gates and commits can cite P-numbers. The PDF
is the authority; this file is the working copy.

- **P01 — Every dashboard element must add meaning.** Strive to: (1) rich
  visualization (charts, heatmaps, etc.), (2) additional insights not currently
  available, (3) related information from multiple sources in a single,
  cohesive view.
- **P02 — Dashboard access must not require login.** Limited preview of SWFI
  data only. Going deeper: already logged in, or redirected to the SWFI login
  page with a return URL; after authentication the user is forwarded to the
  relevant SWFI platform page.
- **P03 — Raw database dumps are not allowed.** Never expose raw database
  entries directly in table format. Tables only for high-value analytical
  views: rankings by AUM / growth / profitability, top investors by region or
  country, most active allocators, rankings by sector or geography, etc.
- **P04 — Every element must justify its presence.** Nothing exists unless its
  meaning is crystal clear; every element carries an implied call to action
  (chart click → relevant SWFI detail view; table row → entity/transaction
  profile). Every navigational path must ultimately lead back to SWFI's core
  platform data WITHOUT EXCEPTION.
- **P05 — Data export must require authentication.** Never allow
  unauthenticated users to download data.
- **P06 — Dashboard language must be user-facing, plain and precise.** No
  cryptic, ad hoc, or ambiguous language, WITHOUT EXCEPTION; no text that casts
  doubt on the integrity of SWFI platform data.

## Compliance actions taken 2026-07-08

- P05: the public "Export CSV" / "Export PNG" buttons on the section
  visualization views (SectionVisualization and CompassVisualization in
  `src/components/SourceListPage.tsx`) were replaced with a
  "Sign in on SWFI to export" link to the platform sign-in.
- P01/P03/P04: every list page's opening Visualization view gained a Dashboard
  2.0 analytical layer — "Top <records>" rankings (largest disclosed value/AUM
  and most recent tabs; each row links to its SWFI record chain) and a
  "Quick Counts" rail (source-side whole-collection counts for facet fields the
  universe charts do not already show; each count links to the filtered view).
- P06: all new labels are plain business language; each new panel states its
  own logic and destination in one line.
- P01.1 (second pass, same day): every list page's Visualization view gains a
  "Where <records> concentrate" category x geography heatmap over the loaded
  records — darker cells hold more records, row/column labels filter the page.
- P01.2 (second pass): a "What stands out" strip of computed observations not
  written anywhere on the page as raw data — category and geography
  concentration percentages, the newest dated record, and the largest
  disclosed figure — each line linking to its records. Both panels render
  nothing instead of empty frames when the loaded records cannot support them.
- Third pass (user-lens wave, same day): (1) "New & updated in this view" —
  a freshness strip classifying loaded records as new or updated inside a
  7-day window (widening once to 30 days), newest first, each row linking
  through the SWFI record chain; (2) a "Closing soonest" rankings tab wherever
  loaded records carry future deadlines ("Closes in N days", soonest first,
  past deadlines excluded) — including the mandates/Compass view; (3) a
  "Focus (optional)" lens: the visitor picks category/geography terms, a
  "Your focus" rankings tab pins matching records first; terms live in
  localStorage only (P02: no login, no server profile) and the panel states
  that in plain language. All ranking/freshness/focus math lives in
  `src/lib/sectionDashboards.ts` with an injected clock, fixture-tested by
  `scripts/swfipn-section-dashboard-logic-test.mjs` (25 checks). AUM history
  sparklines were requested but are blocked: no history/time-series endpoint
  is wired in this repo's frontend surface (checked 2026-07-08); backend wish
  list.
