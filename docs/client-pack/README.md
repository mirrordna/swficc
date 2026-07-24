# SWFI Dashboard Client Documentation Pack

Status: validation pack for the current `/swficc` dashboard scope.

Public validation URL: `https://swfipn.activemirror.ai/swficc/`

This pack explains what the dashboard is, how to use it, how releases should be validated, and what is intentionally out of scope. It is written for testers, product owners, and implementation teams.

## Pack Contents

| Document | Purpose |
| --- | --- |
| `HOW_TO_USE.md` | End-user walkthrough for dashboard discovery, charts, search, rankings, and record navigation. |
| `SOP.md` | Operator process for preflight, release, postflight, and feedback intake. |
| `VALIDATION_CHECKLIST.md` | Evidence-based checklist for stakeholder acceptance testing. |
| `TERMS_AND_BOUNDARIES.md` | Product scope, data-use boundaries, auth assumptions, and non-goals for the validation release. |
| `CURRENT_VALIDATION_STATUS.md` | Client-safe status summary that separates sendable dashboard scope from unfinished full-product scope. |
| `METRIC_GLOSSARY.md` | Customer-facing definitions for dashboard metrics without internal endpoint or database language. |
| `RELEASE_VALIDATION_SCRIPT.md` | Demo/release script for telling testers exactly what changed and what to validate. |
| `RECEIPT_INDEX.md` | Receipt map for operators who need to prove a claim before sending it externally. |
| `KNOWN_CAVEATS_AND_OWNERS.md` | Current caveats, blockers, and ownership buckets. |
| `FEEDBACK_OBJECTIVE_RESPONSE.md` | Response matrix for the latest dashboard feedback objective and the specific validation scenarios to test. |

## Current Product Position

The dashboard is an insight, visualization, and navigation layer on top of SWFI platform data. It should not behave like a parallel profile system or a raw database browser.

Dashboard modules should:

- visualize important patterns, rankings, flows, and comparisons,
- surface insights that are not obvious from raw rows,
- combine related SWFI data packets into a cohesive view,
- route record-level exploration to the appropriate SWFI-backed destination,
- avoid internal implementation language on user-facing screens.

## Source Documents

This pack should be read with:

- `docs/ACCEPTANCE_CONTRACT.md`
- `docs/SWFIPN_DASHBOARD_METRIC_DEFINITIONS.md`
- `docs/doctrine/SWFI_DASHBOARD_INTEGRATION_UX_CONTRACT.md`
- `docs/swfipn-phase2-backend-contracts.md`
- `docs/swfipn-acceptance-status.md`

## Important Caveat

This pack does not claim full BRD Phase 2 completion. The current release is a validation scope for the deployed `/swficc` dashboard/terminal surface. Full product acceptance depends on the latest receipts in `output/`.
