---
name: swfi
description: Use for SWFI API, MCP, dashboard, provenance, content, and data-governance work. Enforces SWFI/ActiveMirror separation, source-backed outputs, read-only defaults, stakeholder approvals, and no autonomous production mutation.
---

# SWFI Skill

## Operating Law

- SWFI is separate from ActiveMirrorOS. Do not mix SWFI data, credentials, memory, receipts, or stakeholder rules with ActiveMirror state.
- Default to read-only. Production mutation, publishing, email, access-control changes, deletion, and bulk writes are blocked unless a human-approved artifact exists.
- Distinguish observed source fact from synthesis.
- Public UI and agent responses must not expose object IDs, internal diagnostics, backend labels, model labels, `source_gap`, stack traces, or secrets.
- Material facts require timestamp, source lineage, confidence, missing-data warning, and query receipt.

## Required References

Load only the reference needed for the task:

- `schema.graphql`: canonical agent-facing GraphQL-style shape.
- `queries.md`: read-only tool/query patterns.
- `mutations.md`: controlled mutation and blocked action rules.
- `auth-and-roles.md`: roles, auth boundaries, and sign-in handoff.
- `errors-and-limits.md`: failure behavior, rate limits, and fail-closed rules.
- `provenance-rules.md`: evidence, staleness, provenance, and synthesis rules.
- `stakeholder-approval.md`: KP/data-owner approval artifacts.
- `publishing-rules.md`: content, outbound communication, and publishing blocks.
- `recipes.md`: common workflows.

## Workflow

1. Identify the SWFI surface: dashboard, backend API, MCP tool, content workflow, or data correction.
2. Confirm the operation mode: read-only, draft write, correction proposal, or human-only.
3. Check `schemas/swfi-mcp-tools.manifest.json` for the tool contract.
4. Use only whitelisted fields and endpoints.
5. Preserve provenance in internal receipts.
6. Fail closed on missing source, stale data, forbidden fields, or absent approval.
7. Run `npm run swfi:agent-governance:gate` after governance contract changes.

## Hard Stops

Stop and report a blocker if asked to:

- publish content,
- send outbound communication,
- modify production records,
- delete or bulk-update records,
- expose private/subscriber-only data publicly,
- use raw Mongo directly from an agent,
- write SWFI private data into ActiveMirror memory,
- bypass stakeholder approval.
