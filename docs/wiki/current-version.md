# Current Version

Last updated: 2026-07-04

## Canonical Working Version

The current canonical dashboard version is the deployed `/swficc` dashboard at:

https://dashboard.swfi.com/swficc/

The previous acceptance hostname remains available for continuity:

https://swfipn.activemirror.ai/swficc/

## Release Identity

- Release path: `/opt/swfipn-acceptance/releases/20260704T090806Z`
- Primary site addresses: `swfipn.activemirror.ai, dashboard.swfi.com`
- DNS record: `dashboard.swfi.com A 161.35.56.218`
- DNS TTL: `300`
- Git SHA from deploy receipt: `b428b5f1644546837b090b994913ff3a5d51300a`
- Git dirty at deploy: `true`

The `git_dirty` flag matters. It means the deployed release includes uncommitted working tree changes. Do not treat the git SHA alone as a complete build identity.

## Version Controller Rule

Codex acts as the engineering version controller for this repository and must:

- keep the canonical version visible,
- reject conflicting side-channel implementation requests,
- map every accepted request to the live requirement source,
- preserve receipts for deploy, DNS, acceptance, link mapping, and visual gates,
- state incomplete or unverified areas plainly.

Paul remains the human authority. SWFI must still designate or confirm the business requirements owner for final scope arbitration.

## What This Version Is

This version is a dashboard and discovery surface intended to sit on top of SWFI platform data and route users into the correct SWFI workflows.

It should feel like one SWFI platform experience and should not expose internal Active Mirror, backend, object-id, source-gap, or debug language to stakeholders.

The top-level dashboard can be public. It should expose only a controlled preview of SWFI data. Deeper record navigation should hand users into SWFI's existing authentication and platform pages with the intended destination preserved.

## What This Version Is Not

This version is not a license to:

- recreate every SWFI profile page in parallel unless explicitly required,
- show raw database tables as the default dashboard experience,
- expose the entire database through dashboard tables or bulk browser screens,
- replace SWFI's existing Phase 1 authentication flow with custom dashboard auth,
- claim full product acceptance without receipts,
- merge independent wish lists into scope without requirement-owner approval,
- use local-only proof as public readiness.
