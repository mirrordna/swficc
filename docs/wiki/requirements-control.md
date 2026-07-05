# Requirements Control

Last updated: 2026-07-04

## Source-Of-Truth Hierarchy

1. Live SWFI requirements document owned by the designated SWFI requirements owner.
2. Accepted BRD and feedback packets imported into that document.
3. Repo acceptance contract and receipt-backed requirement matrix.
4. Stakeholder chats, emails, screenshots, and PDFs after they are normalized into the live document.
5. Code behavior and deployed UI.

Code does not define scope by itself. A feature existing in code does not mean it is accepted or required.

## Current Contract Documents

Known contract/reference docs in this repo:

- `docs/ACCEPTANCE_CONTRACT.md`
- `docs/swfipn-brd-v1-3-acceptance-matrix.json`
- `docs/swfipn-brd-v1-3-current-completion-audit.md`
- `docs/swfipn-brd-v1-3-gap-map.md`
- `docs/doctrine/SWFI_DASHBOARD_INTEGRATION_UX_CONTRACT.md`
- `docs/doctrine/SWFI_PROVABLE_TERMINAL_CONTRACT.md`
- `docs/client-pack/VALIDATION_CHECKLIST.md`

## Intake Rules

Do not implement from raw side-channel feedback unless one of these is true:

- it is a reproducible bug on the canonical deployed version,
- it is already represented in the live requirements document,
- the requirements owner explicitly approves it,
- it is an operational fix required to keep the canonical version reachable.

## Dashboard Mantra

Dashboard elements should:

1. provide rich visualization of data such as charts, rankings, maps, heatmaps, and trends,
2. provide additional insights not immediately available from raw records,
3. bring related information from multiple sources into one coherent view,
4. route users into SWFI core platform workflows without unnecessary duplicate surfaces.

Raw database tables, basic pagination, and duplicate profile-like pages should not be the default dashboard experience.

## Navigation Rule

Every dashboard click path must resolve intentionally:

- public top-level dashboard information can be visible,
- protected drill-down should respect SWFI authentication expectations,
- authenticated users should land in the correct SWFI workflow or profile/detail surface,
- no dead links, fake clickable UI, wrong redirects, or internal citation-only pages on user-facing flows.

## Public Preview And Auth Flow

The initial dashboard should not require login.

It should show a limited, customer-friendly preview of SWFI data. When a user wants to go deeper:

- unauthenticated users should be handed to SWFI's existing login/authentication flow,
- the login URL should preserve the intended destination,
- after authentication, the user should be forwarded to the relevant SWFI platform page,
- authenticated users should not feel like they entered a separate or competing product.

The first redirect to SWFI authentication may be slower than subsequent redirects. That is a known operational/performance concern, not a reason to replace the Phase 1 auth model unless the SWFI requirements owner changes the contract.

## Curated Preview Boundary

The dashboard must not be a blind database dump.

It should remain a limited, curated preview layer that:

- visualizes useful patterns,
- surfaces meaningful insights,
- uses rankings, charts, maps, trend panels, and compact analytical tables where appropriate,
- avoids exposing the entire database,
- avoids raw record grids as the default experience,
- routes users into SWFI's existing platform for deeper record work.

The approved direction is a dashboard and discovery layer on top of SWFI, not a duplicate full terminal and not a public bulk data browser.

## Search Relevance Rule

Dashboard search and autocomplete must use business relevance, not strict alphabetical order.

Until Jaykesh provides the final hierarchy, the interim order should prioritize:

- exact entity/name matches,
- recognized institutional acronyms and synonyms,
- sovereign wealth funds,
- pension funds,
- government funds and investment authorities,
- other institution types by relevance and disclosed scale.

Known examples that must behave correctly:

- `PIF` should surface Public Investment Fund ahead of incidental text matches,
- `Abu Dhabi` should put major SWFI-relevant institutions such as Abu Dhabi Investment Authority ahead of less relevant alphabetical rows,
- `Zurich Insurance Group` should return the matching institution record.

## Language Rule

Stakeholder-visible UI must not contain:

- object IDs,
- `source_gap`,
- Active Mirror internal labels,
- backend/API/model/debug labels,
- provenance-debug language,
- placeholder copy,
- "not disclosed" where a cleaner product-level absence state is required.
