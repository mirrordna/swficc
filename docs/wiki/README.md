# SWFI Dashboard Wiki

Last updated: 2026-07-04

This wiki is the operating reference for the SWFI dashboard/terminal work. It exists to prevent version drift, side-channel scope changes, and unsupported readiness claims.

## Canonical Links

- Current dashboard: https://dashboard.swfi.com/swficc/
- Previous validation URL: https://swfipn.activemirror.ai/swficc/
- Current DO release path: `/opt/swfipn-acceptance/releases/20260704T090806Z`
- Deploy receipt: `output/swfipn-strict-acceptance-deploy-latest.json`
- Domain readiness receipt: `output/swfipn-domain-readiness-latest.json`
- Dashboard DNS receipt: `output/swfipn-dashboard-dns-cutover-latest.json`

## Wiki Pages

- [Current Version](./current-version.md)
- [Dashboard Elements](./dashboard-elements.md)
- [Operating Model](./operating-model.md)
- [Requirements Control](./requirements-control.md)
- [Acceptance And Release](./acceptance-and-release.md)
- [Feedback Log](./feedback-log.md)
- [Glossary](./glossary.md)

## Law For This Project

1. One canonical working version.
2. One live requirements source of truth.
3. No side-channel implementation without mapping the request into the source of truth.
4. No invented data, placeholder claims, or internal-facing product copy.
5. No "done", "ready", "accepted", or "sendable" claim without the matching live receipt.
6. Bad news, blockers, and unverified scope must be stated before progress.

## Current Bad News

- This wiki does not itself prove acceptance. It points to receipts that do.
- `api.swfi.com` is a separate API/DNS cutover issue. Caddy logs show certificate attempts for `api.swfi.com`, but DNS still points at the older SWFI IP. This does not block `dashboard.swfi.com`.
- Full-universe parity must remain explicitly receipt-bound; a green dashboard page is not proof of every backend record.
