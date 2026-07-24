# SWFI Agent Extensions and Proof Layers

Generated for the SWFI dashboard/MCP lane.

## Purpose

This repo now treats SWFI agent tools as governed extensions, not free-form plugins.
Every tool must have:

- an approved source collection
- an approved backend endpoint
- a risk tier
- a read/write mode
- a source lineage path
- a query receipt
- an audit event
- a failure behavior

## Added Proof Layers

### MCP Audit Gate

Command:

```bash
npm run swfi:mcp:audit:gate
```

Receipt:

```text
output/swfi-mcp-audit-gate-latest.json
output/swfi-mcp/audit-gate-log.jsonl
```

Checks:

- every manifest tool produces an audit event
- audit events contain receipt IDs, input hashes, source counts, item counts, and allow/deny state
- controlled mutations are logged as approval-required
- raw input and raw record data are not written to the audit log

### Data Quality Contract Gate

Command:

```bash
npm run swfi:data-quality:contract:gate
```

Receipt:

```text
output/swfi-data-quality-contract-gate-latest.json
```

Checks the contract in:

```text
schemas/swfi-data-quality-contract.json
```

Current rules cover:

- state canonicalization, including `NY` and `New York State`
- money numeric sorting
- ISO date normalization
- source receipt requirements
- public field whitelisting

### Lineage Manifest Gate

Command:

```bash
npm run swfi:lineage:gate
```

Receipt:

```text
output/swfi-lineage-manifest-latest.json
```

Builds a source-to-consumption graph:

```text
source collection -> endpoint -> dashboard module
source collection -> MCP tool
endpoint -> MCP tool
```

This is the repo-level proof primitive for “where did this number/tool response come from?”

### Accessibility Gate

Command:

```bash
npm run accessibility:gate:public
```

Receipt:

```text
output/swfipn-accessibility-gate-latest.json
```

Uses `@axe-core/playwright` against selected public routes. Critical and serious Axe violations fail the gate.

## Explicit Limits

These gates do not prove full-universe data parity by themselves.
They prove governance, schema contract coverage, route/tool lineage, audit logging, and accessibility on selected routes.

Full data parity still requires the existing full-universe/record-parity gates.
