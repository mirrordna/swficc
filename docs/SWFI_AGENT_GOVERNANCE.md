# SWFI Agent, Skill, MCP, and API Governance

Status: implementation contract
Scope: SWFI agent-facing skills, MCP tools, policy gateway, API access, and audit receipts.

## Separation Rule

SWFI is operationally and commercially separate from ActiveMirrorOS.

AMOS or MirrorDNA patterns may inform implementation discipline, but SWFI data, branding, credentials, stakeholder rules, audit receipts, and customer-facing outputs must remain isolated from ActiveMirror memory, secrets, and public surfaces.

## Objective

Agents may help operate SWFI APIs only through bounded tools, deterministic policy checks, and reviewable receipts.

```text
SWFI agent
  -> SWFI skill
  -> SWFI MCP tool contract
  -> SWFI policy gateway
  -> SWFI APIs / databases
  -> verification receipt
```

## Non-Negotiables

- No direct frontend MongoDB access.
- No raw MongoDB access by agents.
- No shared ActiveMirror/AMOS credentials.
- No SWFI private data written into global ActiveMirror memory.
- No autonomous publishing.
- No unrestricted browser automation against production systems.
- No destructive mutation without explicit stakeholder approval.
- No synthesis may overwrite canonical source-backed records.
- No internal diagnostics, object IDs, backend labels, model labels, or source-gap language in public dashboard UI.
- Every material fact returned by a tool must include provenance, timestamp, confidence, missing-data warning, and query receipt.

## State Model

```text
Vault State
  source-backed canonical SWFI records

Synthesis State
  model-generated summaries, comparisons, interpretations, drafts, and notes
```

Rules:

- Synthesis references evidence.
- Synthesis cannot overwrite Vault State.
- Contradictions are surfaced to review.
- Stale or missing values are labeled or hidden.
- Production writes require deterministic validation plus stakeholder approval.

## Tool Risk Tiers

| Tier | Meaning | Examples | Default Action |
| --- | --- | --- | --- |
| `0_public_read` | Public/preview read-only facts. | dashboard counts, public rankings | Allow through gateway with receipt. |
| `1_authenticated_read` | Subscriber or internal read-only facts. | full profile fields, protected reports | Require SWFI auth/session or service role. |
| `2_draft_write` | Creates or updates unpublished drafts. | content drafts, research notes | Allowed only as draft with receipt. |
| `3_correction_proposal` | Proposes canonical-data changes. | record correction proposal | Review queue only; no direct write. |
| `4_human_only` | Production mutation or external action. | publish, send email, delete, access control | Block agent execution; human approval required. |

## Approval Rules

Content and communication approvals must be logged as approval artifacts:

- approver
- timestamp
- scope
- requested action
- before/after diff or draft id
- allowed final action
- expiration or one-time-use marker
- receipt id

Content changes require KP approval unless a newer stakeholder matrix supersedes it.

## Tool Contract Source

The machine-readable source is:

```text
schemas/swfi-mcp-tools.manifest.json
schemas/swfi-mcp-tools.schema.json
```

Each tool must define:

- name
- mode
- risk tier
- approval requirement
- allowed sources/endpoints
- forbidden fields
- input schema
- output schema
- provenance requirement
- receipt requirement
- failure behavior

## Initial Tool Set

Read-only:

- `search_institutions`
- `get_institution_profile`
- `compare_entities`
- `get_recent_transactions`
- `get_live_rfps`
- `get_recent_fundraising`
- `get_top_entities_by_aum`
- `get_source_provenance`

Controlled mutation:

- `create_content_draft`
- `update_unpublished_draft`
- `request_content_approval`
- `propose_record_correction`
- `create_research_note`

Blocked without approval:

- publish content
- send outbound email
- modify production records
- delete records
- bulk mutation
- release private data
- alter access controls

## Verification Mesh

For material outputs:

```text
primary agent/tool result
  -> deterministic schema validation
  -> source/provenance validation
  -> independent review when material or risky
  -> stakeholder approval when external or mutating
  -> receipt
```

Models may suggest. Gates decide.

## Dashboard Integration Rules

Dashboard-facing tools may expose only curated, whitelisted preview data.

Every dashboard-oriented response must include:

- `data_timestamp`
- `source_lineage`
- `confidence`
- `missing_data_warning`
- `query_receipt`

Dashboard-originated record navigation must use the corresponding SWFI core platform record/profile page through SWFI sign-in handoff when the record is gated.

## Agent Memory Rule

Allowed to retain:

- non-sensitive process learnings
- governance patterns
- generic failure classes
- receipt paths and public release identifiers

Not allowed to retain outside the SWFI workspace:

- private SWFI records
- credentials
- customer/subscriber data
- unpublished content
- private stakeholder messages
- raw database exports

## Acceptance Criteria

- Every tool has a schema and risk tier.
- Every returned record includes provenance.
- Every external action has approval.
- No synthesis silently becomes canonical.
- No SWFI data enters ActiveMirror memory.
- All agent sessions are attributable and reviewable.
- The governance gate passes:

```bash
npm run swfi:agent-governance:gate
```

Receipt:

```text
output/swfi-agent-governance-gate-latest.json
```
