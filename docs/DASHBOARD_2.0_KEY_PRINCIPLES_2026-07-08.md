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
