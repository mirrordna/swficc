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
- P02/P03 (fourth pass, same day): the Data-view pager is capped at 4 preview
  pages (`PREVIEW_PAGE_CAP` in the tested lib; 4 more fixture checks). Beyond
  the cap the pager states "This dashboard shows a limited preview of SWFI
  data" and offers "Continue on SWFI ->" to the platform sign-in. Row-limit
  controls (5/10/25/50/100) and one enabled Next click are preserved — the
  two gate scripts that exercise pagination (table-controls-proof,
  route-parity) click Next once on an enabled button. Full totals remain
  honestly disclosed ("Showing 25 of 595,106"). P02 clause 1 re-verified in
  code the same day: no middleware.ts, no local login gate greps. The Data
  view's own framing states its role: "a limited preview, not the database".
- P05 (sixth pass, same day — exhaustive sweep): four more unauthenticated
  download surfaces found and sign-in gated: the research detail
  "Download Source Data" .txt link, the Reports page's Export CSV/PNG pair
  AND its per-table "Download CSV" buttons, and the Aggregates page's
  Export CSV/PNG pair. All download helper code deleted; a residual sweep
  for createObjectURL / link.download / download= across src returns
  nothing. The four gate scripts that asserted the old buttons/text
  (section-visualization, aggregates, e2e, record-mirror) now assert the
  sign-in-gated export instead — without this the next deploy would have
  self-blocked on missing_export_csv, since the morning's P05 fix had
  already removed the buttons the section-visualization gate counted.
- P04 (fifth pass, same day): the last CTA-less elements gained destinations —
  heatmap cells click through to their category's records (tooltip says so),
  all summary tiles on both visualization surfaces carry "Click -> the
  records" (leading-category tile filters to its category), and both monthly
  trend charts carry "Open the dated records ->". Standing sanctioned
  exceptions to "every path ends at SWFI": LinkedIn profile links
  (Paul-sanctioned 2026-07-06, open in a new tab) and the marketing-footer
  social links (team ruling still open, F57).
