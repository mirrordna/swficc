# SWFI Read-Only Query Rules

Use read-only MCP/API tools for:

- institution search,
- institution profile lookup,
- entity comparison,
- recent transactions,
- live RFPs,
- recent fundraising signals,
- top entities by AUM,
- source provenance.

Every query must return:

- data timestamp,
- source lineage,
- confidence,
- missing-data warning,
- query receipt.

Do not expose raw Mongo fields. Do not infer missing AUM, state, date, region, country, amount, or entity type.

For dashboard-originated rows, record navigation should use the corresponding SWFI core platform record/profile page through SWFI sign-in handoff when gated.
