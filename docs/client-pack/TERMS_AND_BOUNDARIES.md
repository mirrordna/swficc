# SWFI Dashboard Terms And Boundaries

This is an operational scope document for the validation release. It is not a legal terms-of-use document.

## Intended Use

The dashboard is intended for:

- public top-level discovery,
- institutional intelligence summaries,
- visualization of SWFI platform data,
- navigation into SWFI-backed records and workflows,
- stakeholder validation of dashboard UX and data presentation.

## Data Boundary

The dashboard may display only approved, whitelisted public fields from server-side SWFI-backed packets.

The dashboard must not expose:

- frontend MongoDB access,
- service tokens,
- subscriber-only fields,
- user-specific dashboard state,
- backend object IDs,
- internal diagnostics,
- API errors,
- source parser/crawler internals.

## Authentication Boundary

The dashboard does not implement a custom authentication system for the validation scope.

Expected behavior:

- top-level dashboard content can be public,
- protected record workflows are gated through the configured SWFI sign-in flow,
- unauthenticated users are redirected to sign in,
- authenticated users should return to the intended record/workflow destination.

## Product Boundary

The dashboard is not a parallel replacement for SWFI's existing profile, person, transaction, Compass/RFP, report, or intelligence assets.

The dashboard should:

- summarize,
- visualize,
- compare,
- rank,
- guide navigation.

The dashboard should not:

- duplicate profile pages as a separate product by default,
- expose raw database browsing as the primary user experience,
- invent values to fill missing data,
- claim full universe parity without current receipts,
- claim full BRD Phase 2 completion unless every required gate passes.

## Change Boundary

New dashboard features or major enhancements should be released with:

- completed work summary,
- milestone or stage,
- workflows ready for validation,
- known caveats,
- gate receipts.

Self-directed additions should not be mixed into acceptance fixes unless they directly implement a previously requested requirement or verified bug fix.

## Privacy And Credentials

Credentials must be handled out of band and injected through environment variables or approved secret storage. Credentials must not be committed to source, docs, screenshots, logs, or client-facing reports.

## Acceptance Boundary

Acceptance requires evidence, not intent.

Evidence should include:

- tested URL,
- auth state,
- expected result,
- actual result,
- screenshot or HTTP trace,
- receipt path,
- `PASS`, `FAIL`, `BLOCKED`, or `UNPROVEN`.

If proof is stale, sampled, missing, or blocked, the claim must be labeled accordingly.
