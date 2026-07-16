# SWFI Acceptance Contract

Frozen spec: BRD v1.3 + Feedback 2026-06-27 + KP feedback 2026-07-15.

## Floor

`NEVER_EVER_LIE` -> `VOLUNTEER_BAD_NEWS` · `NO_ASSUMPTIONS` · `NO_GUESSING` · `source-backed` · `NO_HARDCODING`

## Rules

- No readiness claim without current evidence.
- No assumptions or guessing about auth, routes, data mappings, counts, rankings, source freshness, or visual parity.
- No hardcoded business facts, record IDs, counts, rankings, credentials, source mappings, or expected values as product truth.
- Local Mongo is prohibited in runtime, deployment templates, developer
  overrides, and parity tooling. Only an explicit governed remote source URI is
  accepted, and no environment flag may bypass this rule.
- Fixed IDs or records may be used only as named regression samples.
- User-visible business data must be source-backed or hidden/blocked.
- Bad news comes first: failures, blockers, stale proof, and unproven areas precede successes.
- `200 OK` is not acceptance.
- A link passes only when the destination contains the expected business record.
- A metric passes only when source and calculation are proven.
- Authenticated flow passes only when a logged-in workflow lands on the expected record.

## Enforcement

- Provenance gate: partial, currently figures and figure-bearing arrays.
- Data-parity harness: required.
- Visual baseline: pending.
- Adversarial review: required.

Pending, skipped, stale, or harness-failed proof does not count as accepted.

## KP Feedback 2026-07-15

The following acceptance requirements apply to `dashboard.swfi.com` and must be
proven in a real browser against source-backed API responses:

- Smart Search interprets natural-language intent instead of sending the entire
  sentence as a literal keyword query. The locked examples are:
  - `Top Active Investors` -> transaction-buyer entities ranked by sourced
    activity count through the allocator-activity contract (not the separate
    active-allocators AUM-update contract).
  - `RFPs from the Middle East` -> current RFP/opportunity records whose sourced
    region is Middle East.
  - `Sovereign Wealth Funds investing in AI` -> transaction records whose
    sourced AI industry taxonomy includes a buyer whose sourced entity type is
    Sovereign Wealth Fund.
  - `Pension Funds in Europe` -> entity records whose sourced type is a pension
    type and whose sourced region is Europe.
- Smart Search displays the interpreted intent so the user can distinguish an
  intent-routed result from an unstructured keyword match.
- A natural-language match must retain its SWFI source URL. An inferred entity,
  region, activity, investment, or ranking without a source record fails.
- The Institutions page defaults to AUM descending when AUM is a visible
  column. Alphabetical order remains available only after the user selects it.
- Every Deals industry and sector control, including the Capital Deal Engine,
  accepts more than one selected value, displays the selected values, supports
  individual removal and clear-all, and sends one field-specific source query
  per selected value. Results use OR semantics within the selected field and
  are de-duplicated by transaction identity.
- A UI-only filter over a previously loaded first page does not satisfy the
  Deals requirement.

## Premjit Key Enhancements §8.2.3 — Competition Analysis

The source requirement is page 12 of `Key Enhancements (High Impact) (PN)`.
The example numbers in that document are illustrative and must never be used as
product facts.

- Users can select, remove, and reorder an anchor plus peers. The supported set
  is two to four institutions and is shareable through stable entity IDs.
- The anchor fixes the peer type. A mixed asset-owner, asset-manager, pension,
  sovereign-fund, or family-office set is rejected rather than silently mixed.
- Search results come from the governed entity-search endpoint; selected
  records retain their SWFI entity source links.
- The matrix contains the requested data families: AUM, strategy, regions,
  total transactions, and asset allocation.
- AUM retains its disclosed currency. Mixed currencies are never relabelled as
  USD, converted without an approved rate, or shown on a shared magnitude bar.
- Region distinguishes entity domicile from the latest up-to-25 buyer-side
  transaction sample. The sample is not described as complete investment
  focus.
- Total Transactions is the exact both-role entity-transaction count returned
  by the entity-transaction contract. Buyer-side regional activity is fetched
  and labelled separately.
- Allocation values render only when present on an approved profile packet.
  Reporting periods are not normalized, disclosed ranges remain ranges, and a
  missing allocation is not treated as zero.
- Gap/opportunity cards are deterministic evidence questions. They state their
  checked sample and never infer inactivity, intent, recommendations, or a zero
  allocation from a missing source field.
- Browser acceptance must prove search/add, duplicate prevention, type lock,
  four-peer cap, remove, anchor change, URL restoration, transaction-count API
  parity, allocation/profile parity, source handoff, and mobile containment.

### Strategy Engine

- Strategy Engine output is deterministic and versioned. It may position an
  anchor only against the selected same-type peers and only from approved
  profile, allocation, transaction-total, and recent buyer-activity packets.
- The engine separates observations, coverage gaps, decision-input readiness,
  and next-best research actions. Every observation retains one or more SWFI
  record links.
- It must explicitly block conclusions that require mandate objectives,
  liabilities, liquidity needs, risk budget, return targets, time horizon,
  governance constraints, thematic exposure, manager exposure, co-investor
  exposure, sector/stage/ticket-size opportunity fit, multi-period trajectory,
  or complete transaction history when those contracts are absent.
- It is decision support, not investment advice, portfolio optimization,
  expected-return forecasting, mandate-fit scoring, or inferred intent.
- Browser acceptance must prove the engine version, all readiness dimensions,
  source links, and the visible cannot-conclude boundary.

## Homepage top-story preview and refresh

- The Latest Intelligence lead is explicitly ordered newest-first by a valid
  publication timestamp, with numeric WordPress legacy ID as the bounded
  fallback when the timestamp is unavailable.
- The lead image comes from the story's public SWFI CMS featured image through
  a same-origin backend preview endpoint. The proxy accepts numeric post IDs,
  follows only HTTPS redirects on an explicit SWFI CMS/CDN host allowlist,
  permits bounded raster image types and sizes, and never accepts a caller URL.
- Preview caching is an in-memory optimization only. Remote SWFI editorial
  media remains the truth source, and a process restart safely re-fetches it.
- Missing or rejected editorial media falls back to a stable story-derived
  visual carrying the story identity; it does not leave a broken image or
  reuse a fixed slot image.
- The browser polls the news source every five minutes and performs a
  rate-bounded refresh when a hidden tab becomes visible. Browser acceptance
  must force the same refresh path and prove that a new lead story changes the
  headline, story identity, link, and image together.

## Full Universe Parity

Full universe parity is not the same as full universe mapping.

Full universe parity may only be claimed when all layers pass with current receipts:

- source/destination manifest
- source universe mapping coverage
- every mapped detail/API route renders
- every required source field matches the mirror/backend value
- browser route/link parity is exhaustive, not sampled
- visual baseline is current
- adversarial review is current

If any layer is sampled, stale, missing, blocked, harness-failed, or not implemented, full universe parity is `UNPROVEN`.

Guard command:

```bash
npm run brd:contract-truth:gate:public
```

Source/destination manifest command:

```bash
npm run manifest:source-destination:public
```

The manifest is mapping evidence only. It does not upgrade full universe parity unless the contract truth gate passes.

## Output

Every acceptance claim must produce a receipt with:

- requirement
- tested URL
- auth state
- expected result
- actual result
- evidence path or trace
- status: `PASS`, `FAIL`, `BLOCKED`, or `UNPROVEN`
