# Acceptance And Release

Last updated: 2026-07-04

## Acceptance Principle

HTTP `200` is not acceptance.

Acceptance requires the right page, right data, right interaction, right routing, right copy, and current receipts.

## Current Validation Surface

Use:

https://dashboard.swfi.com/swficc/

Keep the older hostname only as continuity/fallback:

https://swfipn.activemirror.ai/swficc/

## Required Evidence Types

| Area | Evidence |
| --- | --- |
| Deploy | `output/swfipn-strict-acceptance-deploy-latest.json` |
| DNS/domain | `output/swfipn-domain-readiness-latest.json`, `output/swfipn-dashboard-dns-cutover-latest.json` |
| Share readiness | `output/swfipn-share-gate-latest.json` |
| Acceptance criteria | `output/swfipn-acceptance-criteria-gate-latest.json` |
| KP acceptance | `output/swfipn-kp-acceptance-gate-latest.json` |
| Link leakage | `output/swfipn-visible-link-escape-gate-latest.json`, `output/swfipn-link-mapping-leakage-gate-latest.json` |
| Search | `output/swfipn-global-search-brd-gate-latest.json` |
| Visual/dashboard feedback | `output/swfipn-section-visualization-brd-gate-latest.json`, `output/swfipn-feedback-objective-gate-latest.json` |
| Full universe | `output/swfipn-full-universe-mapping-latest.json`, `output/swfipn-brd-contract-truth-gate-latest.json` |

## Release Checklist

Before telling the team a version is ready for validation:

1. Confirm the canonical URL loads.
2. Confirm current release path and deploy receipt.
3. Run the relevant acceptance gates for the changed area.
4. Capture screenshots where visual or UX feedback is involved.
5. State validation scenarios in plain language.
6. State known gaps and blockers before success claims.

## Current Domain State

`dashboard.swfi.com` is now DNS-mapped to the DO dashboard droplet:

```text
dashboard.swfi.com A 161.35.56.218
```

Caddy serves the dashboard for:

```text
swfipn.activemirror.ai
dashboard.swfi.com
```

Known separate issue:

```text
api.swfi.com still points to older SWFI infrastructure.
```

Do not mix dashboard-domain acceptance with API-domain cutover acceptance.

