# SWFI Provenance Rules

Every material fact needs:

- source collection or source system,
- source URL when available,
- source record id in internal receipt,
- source updated time or effective date,
- query/sync time,
- confidence,
- missing-data warning,
- receipt id.

Vault State:

- canonical source-backed SWFI records.

Synthesis State:

- summaries, comparisons, interpretations, drafts, notes.

Rules:

- synthesis cannot overwrite vault state,
- contradictions go to review,
- stale facts are labeled or hidden,
- source gaps are internal only,
- public outputs must not expose diagnostics.
