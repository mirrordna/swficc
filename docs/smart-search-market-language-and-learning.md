# Smart Search market language and governed learning loop

Date: 2026-07-16

## Product boundary

Smart Search translates institutional-investment language into source-specific SWFI query plans. A result is only presented as an interpreted intent when the serving contracts can prove every material filter. Literal names and unsupported natural-language questions remain on the existing search path.

The current release uses deterministic intent parsing. Machine learning can improve classification and ranking later, but it must not silently change source records, query contracts, or production behavior.

## Language used in this market

Institutional users commonly combine an action with an actor, subject, geography, time window, and measure:

`show | find | rank | compare | break down | how changed`

`asset owner | allocator | LP | sovereign investor | pension plan | family office | manager | consultant`

`mandate | RFP | commitment | allocation | exposure | direct investment | co-investment | holding | cash flow`

`region | country | sector | industry | strategy | vintage | fund size | vehicle type`

`last 90 days | trailing 12 months | since inception | current | target | forecast`

`AUM | IRR | TVPI | DPI | RVPI | commitment size | activity count`

### Canonical terms and aliases

| Canonical concept | User language to recognize |
| --- | --- |
| Asset owner / allocator | institutional investor, capital allocator, investor, plan sponsor, LP |
| Sovereign wealth fund | SWF, sovereign investor, state-owned investor, government fund |
| Public pension fund | pension fund, pension plan, retirement system, public plan, superannuation fund, super fund |
| Investment manager | asset manager, external manager, fund manager, GP |
| Investment consultant | consultant, OCIO, outsourced CIO, fiduciary manager, delegated solutions |
| Opportunity | RFP, request for proposal, mandate, manager search, investment search, open search |
| Allocation | target allocation, policy allocation, actual allocation, asset mix, exposure |
| Commitment | LP commitment, planned commitment, re-up, recommitment |
| Deployment | actively deploying capital, investment pace, commitment pacing, dry powder |
| Direct activity | direct investment, co-investment, co-invest, transaction, deal |
| Manager workflow | screening, search and selection, due diligence, ODD, monitoring, manager review |
| Geography | MENA, GCC, EMEA, APAC, LATAM, Oceania, the Americas |

Important distinctions remain explicit:

- SWFs, public pensions, and central banks are sibling state-owned-investor types, not synonyms.
- An RFP, open mandate, emerging mandate, and replacement mandate describe different stages.
- Investor appetite is not an actual commitment.
- Target allocation is not actual exposure.
- A direct investment is not a fund commitment.
- Deal-based activity is not AUM freshness.
- Buyer domicile is not deal-target geography.

## Supported intent families

The current contracts support these natural-language families:

1. Active allocator rankings, optionally constrained by a recognized entity type and region.
2. Regional RFPs, mandates, opportunities, and manager searches.
3. Regional institutions by sourced entity type.
4. Institutional buyer type plus a sourced transaction theme and a 30-, 90-, 180-, or 365-day window.

Examples:

- `Top active investors`
- `Most active sovereign investors in the GCC`
- `Family offices actively deploying capital`
- `RFPs from the Middle East`
- `Open manager searches in EMEA`
- `Pension funds in Europe`
- `Central banks in APAC`
- `Family offices in MENA`
- `Sovereign wealth funds investing in AI`
- `Pension plans investing in healthcare in the last 90 days`
- `Family offices deploying capital into real estate`
- `Endowments investing in biotechnology`
- `SWFs with exposure to infrastructure`

Recognized transaction themes currently map to serving taxonomy values for AI, infrastructure, healthcare, real estate, energy, information technology, financials, industrials, cybersecurity, semiconductors, renewables, biotechnology, agriculture, and software.

An investment query that also contains a region is not interpreted yet because the region can refer to either investor domicile or target geography. Returning an unfiltered or incorrectly filtered answer would be worse than keeping the query unresolved.

## High-value queries requiring new contracts

| Query family | Missing proof contract |
| --- | --- |
| LPs committed to a named fund and amount | LP to fund to commitment join |
| Investors planning to increase an allocation | Dated intention/appetite evidence |
| Funds still fundraising above a threshold | Fundraising lifecycle, target, closes, and status |
| Top-quartile funds by IRR, TVPI, or DPI | Fund performance and benchmark universe |
| GP fundraising momentum and dry powder | GP to funds to closes to dry-powder aggregate |
| Plans underweight a strategy with an open mandate | Dated target/actual allocation joined to mandate |
| Consultants advising a plan on a search | Consultant to client to mandate relationship |
| Incumbent managers vulnerable to replacement | Manager roster, product performance, and replacement signal |
| LPs due to re-up | Fund family, commitment history, and cash-flow pacing |
| Look-through sovereign exposure | Holdings, fund look-through, and direct transactions |
| Co-investor network around an institution | Exact participant graph and role-aware aggregation |
| Full-universe largest or most-active ranking | Server-side full-universe sort and count, not a 100-row preview |

Until those contracts exist, the interface should show a precise capability gap rather than synthesize an answer.

## Governed ML improvement loop

### 1. Observe

Record privacy-minimized search events in the remote governed store:

- normalized query and a one-way user/session pseudonym;
- parser and model version;
- proposed and accepted intent;
- source contracts executed;
- result count, latency, and source completeness;
- clicked or saved record IDs;
- zero-result, abandonment, and reformulation signals;
- explicit analyst correction or relevance feedback.

No local Mongo is permitted. Raw credentials, email content, and unrestricted personal data are excluded.

### 2. Learn offline

- Build a labeled replay set from accepted analyst corrections and aggregated behavior.
- Train an intent classifier and result reranker outside the request path.
- Treat clicks as weak evidence, not ground truth; correct for position bias.
- Keep taxonomy, entity-type, source, and date constraints deterministic.
- Version the dataset, features, model, prompt, metrics, and source-contract manifest together.

### 3. Prove

A candidate must beat the current release on a fixed evaluation set before receiving traffic:

- intent precision and recall by intent family;
- precision at 5 and NDCG at 10;
- unsupported-intent false-positive rate;
- zero-result and reformulation rate;
- source-link coverage and source-contract violations;
- p50/p95 latency;
- freshness and date-order accuracy.

No aggregate win may hide a regression for sovereign, pension, family-office, or regional queries.

### 4. Canary and rollback

- Run candidates in shadow mode first.
- Canary a small, deterministic traffic slice.
- Compare against the pinned baseline and contract gates.
- Promote only through an auditable model manifest.
- Automatically roll back on precision, source, freshness, latency, or error-budget regression.

### 5. Self-healing boundary

Safe automated healing includes:

- retrying a transient source call;
- falling back from semantic ranking to deterministic search;
- disabling a failing intent family with a visible reason;
- rebuilding a stale index from the remote canonical source;
- alerting on schema drift, date gaps, empty partitions, or broken source handoffs;
- rolling back a bad model or parser version.

It does not include changing source records, inventing classifications, expanding entitlements, modifying production schemas, or retraining directly from a single user's click.

## Current market sources

- [MSCI Connector user guide, May 2026](https://www.msci.com/downloads/web/msci-com/data-and-analytics/private-asset-solutions/ai-for-private-markets/msci-mcp-msci-connector-user-guide.pdf)
- [MSCI Private Capital Intel](https://www.msci.com/data-and-analytics/private-asset-solutions/msci-private-i/private-capital-intel)
- [Preqin investor and manager profiles](https://www.preqin.com/data/profiles)
- [Preqin investor-document search](https://www.preqin.com/help-center/articles/view/sourcing-investor-documents)
- [PitchBook limited-partner data](https://pitchbook.com/platform-data/limited-partners)
- [PitchBook mandates, allocations, and commitments workflow](https://pitchbook.com/blog/how-to-research-investors-previous-commitments-and-current-allocations-with-pitchbook)
- [Nasdaq eVestment mandate intelligence](https://www.nasdaq.com/solutions/evestment/asset-managers/next-best-action-for-institutional-capital)
- [Mercer investment-manager research](https://www.mercer.com/en-us/solutions/investments/wealth-managers/investment-manager-research/)
- [IFSWF direct-investment data project](https://www.ifswf.org/ifswfs-data-project)
- [Global SWF data platform](https://globalswf.com/)
- [FINTRX family-office and RIA intelligence](https://www.fintrx.com/blog/how-fintrx-caters-to-various-financial-professionals)
- [Dakota institutional-investor database](https://www.dakota.com/institutional-investor-database)
