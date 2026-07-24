# Meeting Summary 2026-07-03 — LINE BY LINE — status 2026-07-05 late night

Source: "Meeting Summary (1).docx" extracted to 240 lines (extraction receipt
in session scratchpad, minutes-full.txt). Every line below carries its line
number from that extraction. Statuses:

- **LIVE** — on dashboard.swfi.com now (release 20260705T140957Z unless noted), receipt cited
- **COMMITTED** — fixed on branch takeover/wip-snapshot-2026-07-05, awaiting next deploy
- **TEAM / PAUL** — owner per the minutes themselves; not deliverable by code
- **OPEN** — honestly not done / needs a decision

Live-receipt shorthand used below: `search3/10` = curl of
/api/v1/public/search q="Abu Dhabi" limit=3 and limit=10 both returning
Abu Dhabi Investment Authority first; `walk` = scripts/swfipn-exhaustive-clickwalk.mjs
receipt (26 pages, 2,210 anchors, 1,204 swfi.com links, 0 dead internal links,
38 social-footer externals); `pw` = Playwright rendered-page probe this hour.

## Lines 1–18 — title, date, attendees, purpose (context; no action)

1–2 title/date · 3–8 attendees (Jaykesh, KP, Paul, Premjit) · 9–17 purpose
statements (each purpose materializes as sections A–P below) · 18 header.
The one purpose line with standing effect: 15 "Preventing Paul from receiving
conflicting instructions" → one lane, one owner since 2026-07-05 (Codex paused
via organism-chat; every change flows through this branch + change notes).

## A. Multiple versions (19–23)

- 19–22 (confusion, Michael's separate BRD, unfair to Paul): context. Lane
  consolidation done on my side; document ownership is N/actions 11–13 = TEAM.
- 23 "one aligned version, one working document, one coordinated instruction
  flow": **PARTIAL — my half LIVE** (one branch, one deploy path, change notes
  docs/CHANGE_NOTES_2026-07-05.md); the "one working document" (high-impact
  doc) = **TEAM (Premjit owns, line 102)**.

## B. Revert to SWFIPN base (24–27)

- 25 reverted to preferred version: **LIVE** — dashboard.swfi.com serves the
  swfipn build (302 → /swficc/, stamp v=20260705T140957Z).
- 26 version-name confusion (Swift VPN/Swiftly 2/Demo 2): resolved by M —
  demo2.swfi.com is a separate deployment, distinct from this dashboard.
- 27 decision (SWFIPN as base, enhance incrementally): **LIVE** — all fixes
  this week are increments on that base; no rebuild.

## C. Login and access flow (28–35)

- 30 "initial dashboard should not require login": **LIVE** — all preview
  pages load unauthenticated (walk: 26 routes, all 200).
- 31 "limited preview of SWFI data": **LIVE at dashboard level** (curated
  panels), but see line 39 tension below.
- 32 "deeper → already logged in or redirected to SWFI login": **LIVE** —
  record links use swfi.com/v1/signin/?msg=auth&redirect=<record>; even the
  legacy /swficc/login/ path 302s to that signin (pw receipt).
- 33 "after authentication, forwarded to the relevant SWFI platform page":
  **LIVE, proven authenticated** — in Paul's logged-in Safari the ADIA handoff
  resolved to the real entity record and a compass handoff resolved to the
  Weymouth RFP record (2026-07-05 receipts).
- 34 slow first redirect: **LIVE (my half) + TEAM (their half)** — measured:
  ~0.9s connection setup (now removed by a preconnect hint, live: 1 preconnect
  tag on /swficc/) + ~1.2s swfi.com server time (their side; their /about-us
  even timed out a 45s automated fetch today). Residual = swfi.com origin,
  matches KP's own suspicion in this line.
- 35 principle (preview + navigation to platform): **LIVE** — walk counted
  1,204 swfi.com-terminating links; 0 dead internal links.

## D. Not a database dump (36–39)

- 37 "should not expose or dump the entire database": **LIVE at the dashboard
  level** — the home page is curated panels only.
- 38 "more visual, meaningful, customer-friendly": **LIVE** — list pages now
  chart source-side distributions over the WHOLE collection ("All records by
  Type/Country", live facets API total 595,106 with per-field coverage
  disclosure), replacing page-slice charts (pw: universe_chart true,
  coverage line true).
- 39 decision "limited, curated preview, not a full database dump":
  **OPEN — needs a team ruling**: list pages still allow paginated browsing
  of the full universe (they honestly disclose "Showing 25 of 595,106"). If
  the team reads "no dump" strictly, we should cap browse depth; I did not
  unilaterally nerf pagination. Flagged for KP/Premjit.

## E. Search (40–53)

- 43 "PIF did not return expected results": **LIVE FIXED** — PIF → Public
  Investment Fund first (alias fan-out; test pinned).
- 44 "Abu Dhabi did not return entities": **LIVE FIXED** — ADIA first at
  limit 3 AND 10 (search3/10 receipt). Root cause found today: the backend
  had NO ranking at all (first-N in storage order; the first result changed
  with the requested count). Now: rank full pool (match quality → SWF >
  pension > others → USD size), truncate last. 4 tests pin it.
- 45 "Zurich Insurance Group not working": **LIVE FIXED** — first result
  (2026-07-05 receipt).
- 46 "links and search results appeared nonfunctional": **LIVE** — walk: 0
  dead internal links across 2,210 anchors; search result rows land on
  signin+record handoffs.
- 47 (Paul already working on it): historical, true.
- 48 "not strict alphabetical; business/customer hierarchy": **LIVE** —
  SWF > pension > others ordering implemented server-side and test-pinned
  (search3/10 + hierarchy test).
- 49–52 "Jaykesh to provide hierarchical ordering list (SWFs, pensions,
  others)": **TEAM (Jaykesh)** — interim hierarchy live matches exactly the
  categories in lines 50–52; swaps in Jaykesh's list when provided.
- 53 "Immediate task: fix the search bar and entity search": **LIVE** — done
  as above.

## F. Clear logic behind buttons/tabs/navigation (54–58)

- 55–56 (uncertainty about plus signs/buttons/tabs): **LIVE** — every
  expandable panel toggle carries a one-line explain strip; all 6 KPI cards
  carry meaning+destination tooltips (pw: map explain rendered, AUM tooltip
  present, 8 "Click →" destination lines).
- 57 "all elements must have clear business logic and purpose": **LIVE +
  COMMITTED sweep** — today's literal sweep found and fixed three violators:
  dead "Alerts" tab (empty data source → tab removed, page now says honestly
  alerts don't exist yet) — COMMITTED; account-page "Sign In" targeting a
  nonexistent /login route — COMMITTED (all Sign In links now go directly to
  swfi.com signin; live impact was softened by a server 302 that already
  landed on signin); marketing-footer social links (twitter/linkedin/facebook
  ×38 on 13 marketing pages) — **OPEN team judgment**: they're SWFI's own
  socials, but literal G says chains end at SWFI properties.
- 58 "No button, metric, tab, or chart unless the team can explain it":
  **LIVE (surfaces) + TEAM (the explaining)** — the definitions the team must
  defend in demos (lines 70–71) are theirs to own; every on-dashboard element
  now states its own meaning/destination.

## G. Navigation ends at the SWFI platform (59–63)

- 61 "final endpoint should be the existing SWFI platform": **LIVE** — walk:
  1,204 swfi.com links; detail routes forward (id-backed routes observed
  redirecting; the acceptance gate now asserts the forwarding contract).
- 62 "click and drill into meaningful info" for AUM-type metrics: **LIVE** —
  each KPI tooltip names its click destination; AUM card → ranked
  institutions list → swfi.com records.
- 63 rule (platform = source of truth; dashboard = preview/nav layer):
  **LIVE + COMMITTED tail** — one literal gap found tonight: detail links
  carrying only a slug (no record id) bounced back to the preview instead of
  reaching SWFI. Fixed: they now forward to swfi.com's public search
  (verified 200 unauthenticated) — COMMITTED, awaiting deploy.

## H. Metrics must be explainable (64–71)

- 66 "Total AUM Engaged": **LIVE REMOVED** — 0 occurrences on the home page;
  replaced by "TOP-RANKED AUM TOTAL" (grep receipt tonight).
- 67 "Sovereign Wealth Fund AUM Tracked": renamed to truth-labels in the same
  pass ("TOP 5 BY AUM" sidebar).
- 68 "a figure around $16.3 trillion": **LIVE, now defensible** — the card
  shows $16.8T explicitly-USD (live API total_assets_usd), with a tooltip
  stating the computation and that mixed-currency sums are suppressed. The
  old 16.9T was a cross-currency artifact (NOK+SAR+CNY summed as if dollars);
  the team's $16.3T ballpark was right, the labels weren't.
- 69 what does "engaged" mean: **TEAM (KP/Premjit/Jaykesh, action 8)** — the
  word no longer appears anywhere; define it only if you want it back.
- 70–71 (Premjit/Jaykesh must explain every metric; show nothing
  undefendable): **LIVE (mechanism) + TEAM (ownership)** — every visible
  number now states meaning, source scope, and destination; the demo-day
  explaining is theirs.

## I. Peer comparison logic (72–76)

- 73 asset manager vs family office compared: **LIVE FIXED** — peer set locks
  to the anchor record's entity type (pw: "Peer group:" line rendered).
- 74 "comparisons only between similar entity types": **LIVE** — same-type
  filter + header disclosure ("comparisons stay within one entity type").
- 75 "there may be exceptions": **TEAM** — exception rules undefined in the
  minutes; none implemented (deliberately strict until the team defines them,
  line 228–229).
- 76 requirement recorded: **LIVE** as above.

## J. Dashboard vs detailed profile pages (77–81)

- 79 "detailed profile should not live inside the dashboard; redirect to the
  platform": **LIVE** — all six detail routes render a forwarding surface to
  the swfi.com record handoff; the in-app record page component
  (RecordDetailPage) is deleted from the codebase — COMMITTED (it was already
  unreachable).
- 80 "minimal information without login": **LIVE** — preview lists only;
  depth requires the swfi.com session (Safari-proven, line 33 receipt).
- 81 decision: **LIVE + COMMITTED tail** (slug-only forwarding, line 63).

## K. Investment strategy field (82–86)

- 83 KP liked the strategy field: **LIVE** — "Investment Strategy" row
  renders in Peer Comparisons with real source text (pw: strategy_row true;
  data from the profile packet's strategy module, live-verified for ADIA).
- 84 "not currently shown on the existing platform": platform side = TEAM.
- 85 locate the version (action 14): **DONE** — implementations located in
  this repo + the separate demo2 terminal's tearsheet; KP backend access
  (action 15) = **PAUL**.
- 86 evaluate for future: **TEAM** (with the live comparisons row as the
  working demo).

## L. Icons (87–90)

- 88–90 KP's generated icons; Jaykesh+Premjit to review: **TEAM** — nothing
  deliverable in code until they choose.

## M. Subdomain (91–96)

- 92–96 dashboard.swfi.com: **LIVE** — DNS resolves to the acceptance box and
  serves the build (every receipt in this document was taken against it).

## N. Requirement management (97–106)

- 100 "Paul should not immediately implement every new idea": **IN FORCE** —
  this lane implements from the minutes + Paul's direct instructions only.
- 101–105 high-impact doc, Premjit owns, BRD review, Deepika routing:
  **TEAM** (Premjit/Jaykesh/KP per lines 102–105).
- 106 decision: **TEAM**.

## O. QA and testing (107–116)

- 108 no dedicated QA; Paul can't test everything alone: acknowledged — which
  is why the exhaustive click-walk script now exists
  (scripts/swfipn-exhaustive-clickwalk.mjs, receipt committed).
- 110–111 fix + notify: **LIVE** — docs/CHANGE_NOTES_2026-07-05.md (16
  numbered notes, each with "Test:" instructions) + this line-by-line.
- 112–114 team tests, screenshots, Paul confirms: **TEAM** loop, ready to
  receive.
- 115 "mention what changed with each update": **LIVE** — change notes +
  commit messages carry what/why/test.
- 116 decision: **LIVE (my half) / TEAM (their half)**.

## P. GitHub repository (117–120)

- 118 repo created/shared: **DONE** — github mirrordna/swficc, branch
  takeover/wip-snapshot-2026-07-05 pushed through 22b7236 tonight.
- 119 KP interested in strategy code: pointers in change notes; backend
  repo access = **PAUL** (action 15).
- 120 decision: **DONE (repo) / PAUL (invites)**.

## Actions table (121–201) — one line each

- 126–129 **1** SWFIPN base → LIVE (B).
- 130–133 **2** search fix incl. PIF/Abu Dhabi/Zurich → LIVE (E; search3/10).
- 134–137 **3** Jaykesh hierarchy list → TEAM; interim hierarchy LIVE (E48).
- 138–141 **4** icons review → TEAM (L).
- 142–145 **5** dashboard.swfi.com → LIVE (M).
- 146–149 **6** navigation → platform → LIVE (G; walk).
- 150–153 **7** every clickable leads somewhere meaningful → LIVE + COMMITTED
  sweep (F57: Alerts tab, Sign In, slug forwarding) + OPEN (social footers).
- 154–157 **8** clarify/replace "Total AUM Engaged" → label REMOVED LIVE;
  definition TEAM.
- 158–161 **9** no unexplainable numbers → LIVE mechanism (explains/tooltips);
  demo-day ownership TEAM.
- 162–165 **10** peer-type comparisons → LIVE (I).
- 166–169 **11** BRD review → TEAM (Premjit/Jaykesh).
- 170–173 **12** high-impact doc as living source → TEAM (Premjit).
- 174–177 **13** route new ideas through the doc → TEAM (KP/Premjit/Jaykesh).
- 178–181 **14** locate strategy version → DONE (K85).
- 182–185 **15** KP backend access → PAUL.
- 186–189 **16** GitHub repo → DONE/PAUL (P).
- 190–193 **17** change notes per fix → LIVE (O110; CHANGE_NOTES + this doc).
- 194–197 **18** team tests fixes with screenshots → TEAM.
- 198–201 **19** capture/share minutes → DONE (the source doc + this audit).

## Takeaways (202–212)

All ten takeaway lines restate A–P above; per-line statuses identical to
their sections: 203→A/N · 204→B · 205→N · 206→C/G · 207→H · 208→E (LIVE) ·
209→F · 210→I (LIVE) · 211→K (LIVE in comparisons) · 212→O.

## Follow-up questions (213–237)

- 216–217 "engaged" meaning → label gone LIVE; definition TEAM (H69).
- 218–219 what each metric leads to → LIVE (tooltips name destinations).
- 220–221 plus sign purpose → LIVE (panel expanders carry explain strips;
  none is purposeless; if the team still wants any removed, say which).
- 222–223 autocomplete hierarchy → TEAM (Jaykesh); interim live.
- 224–225 which version has strategy → DONE (K85).
- 226–227 strategy in dashboard or platform → TEAM evaluation; live demo
  available in Comparisons.
- 228–229 comparison exceptions → TEAM to define; none implemented.
- 230–231 BRD ideas to retain → TEAM.
- 232–233 internal environment name → DONE: dashboard.swfi.com.
- 234–235 login redirect performance → preconnect LIVE (~0.9s saved);
  residual is swfi.com server time — future TEAM/technical review, exactly
  as this line anticipated.
- 236–237 who maintains minutes/change logs → change notes maintained in-repo
  by Paul's lane (docs/CHANGE_NOTES_2026-07-05.md); formal owner TEAM.

## Lines 238–240 — conclusion (context; no action)

## Bottom line

- **LIVE tonight**: B, C (incl. authenticated forward + preconnect), E (all
  three named searches + hierarchy + limit-independence), F explains, G
  chains, H labels + defensible USD AUM, I same-type, J forwarding, K
  strategy row, M subdomain, O change notes, P repo.
- **COMMITTED, awaiting one deploy**: Alerts tab removal + honest page,
  direct swfi Sign In links, slug-only forwarding, RecordDetailPage deletion.
- **OPEN for the team**: full-universe pagination vs literal "no dump" (39),
  social footer links (57), "engaged" definition (8), comparison exceptions
  (75), icons (L), doc process (N), Jaykesh hierarchy (3), KP access (15).
- **Not claimed**: nothing beyond the receipts named here.
