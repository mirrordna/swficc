# SWFI Mutation Rules

Allowed agent mutation classes:

- create unpublished content draft,
- update unpublished draft,
- request content approval,
- propose record correction,
- create internal research note.

Blocked without explicit approval:

- publish content,
- send outbound email or message,
- modify production records,
- delete records,
- bulk mutation,
- release private data,
- alter access controls.

Production data correction flow:

```text
evidence
  -> proposed correction
  -> deterministic validation
  -> human/data-owner approval
  -> controlled production write by approved operator
  -> receipt
```

Agents do not directly write canonical SWFI records.
