# SWFI Errors and Limits

Fail closed when:

- source packet is stale,
- source record is missing,
- required provenance is missing,
- forbidden fields are present,
- approval artifact is missing,
- caller role is insufficient,
- schema validation fails,
- upstream returns raw backend errors.

Preferred public behavior:

- hide unavailable module,
- show approved empty state,
- preserve internal QA receipt.

Limits:

- default list limit: 25,
- public preview maximum: 25 unless a contract says otherwise,
- no bulk mutation through agent tools,
- no unrestricted crawler against production.
