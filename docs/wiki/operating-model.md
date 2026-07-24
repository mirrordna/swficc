# Operating Model

Last updated: 2026-07-04

## Purpose

The operating model exists because the team identified confusion caused by multiple dashboard versions, mixed backend/frontend states, and several stakeholders sending partially conflicting instructions.

The agreed direction is:

- one aligned version,
- one working requirements document,
- one coordinated instruction flow,
- one validation surface,
- evidence-backed release notes.

## Roles

| Role | Responsibility |
| --- | --- |
| Paul | Human authority and final delivery owner. |
| Codex | Engineering version controller, implementation worker, receipt keeper, and bad-news reporter. |
| SWFI requirements owner | Owns the live requirements document and reconciles stakeholder input before it becomes implementation scope. |
| KP / Premjit / Jaykesh / Deepika / Michael / team | Provide feedback through the coordinated requirements flow. |

The SWFI requirements owner must be explicit. Until named, requirements ownership is a process blocker for ambiguous or conflicting requests.

## Instruction Flow

1. Stakeholder feedback is collected.
2. Requirements owner reconciles it into the live requirements document.
3. Codex implements only items that are in that document or explicitly approved as a bug fix.
4. Codex produces a validation summary with tested URL, changed area, expected behavior, receipt, and known gaps.
5. Stakeholders validate the intended scenarios, not an undefined moving target.

## Change Classes

| Class | Action |
| --- | --- |
| Bug | Fix when reproducible or receipt-backed. |
| Requirement | Implement only after it is in the live requirements source. |
| Design preference | Capture and route to requirements owner unless already approved. |
| New idea | Do not implement directly; add to candidate backlog. |
| Contradictory instruction | Stop, document conflict, and ask for owner decision. |

## Release Summary Standard

Every meaningful release should say:

- what changed,
- what milestone/stage it belongs to,
- what scenarios are ready for validation,
- what receipts were generated,
- what remains blocked or unverified.

