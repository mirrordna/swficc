# Known Caveats And Owners

This file separates dashboard-validation issues from broader product/platform work.

## Current Dashboard Validation Scope

Owner: dashboard implementation team.

Tracked areas:

- dashboard presentation,
- insight modules,
- chart/ranking/export behavior,
- search/discovery entry points,
- row/link navigation,
- mobile usability,
- public copy and internal-language cleanup,
- validation documentation.

## Data / Metric Definition

Owner: SWFI product/data owner plus implementation team.

Requires explicit agreement for:

- exact metric formulas,
- inclusion/exclusion criteria,
- date windows,
- currency handling,
- ranking tie-breakers,
- stale-data behavior,
- what should be public vs gated.

## Full Field Parity

Owner: backend/data parity lane.

Current boundary:

- mapping coverage alone is not field parity,
- field parity requires record-by-record value comparison with current receipts,
- do not claim full parity until the field-parity and contract-truth receipts pass.

## SWFI Auth / Session Bridge

Owner: SWFI platform/auth owner plus implementation team.

Current boundary:

- dashboard validation can proceed for public top-level discovery,
- final auth continuity requires target-runtime configuration and passing receipts.

## Email Delivery

Owner: runtime/platform owner.

Current boundary:

- email delivery should not be claimed live until required runtime keys/from-address are configured and the delivery gate passes.

## API DNS / Production Cutover

Owner: infrastructure/DNS owner.

Current boundary:

- DNS cutover should not be claimed until the cutover gate and rollback plan pass with the correct permissions.

## Legal Terms

Owner: SWFI/legal.

Current boundary:

- `TERMS_AND_BOUNDARIES.md` is an operational scope document,
- it is not legal terms of use,
- legal/customer terms require review by the appropriate owner.
