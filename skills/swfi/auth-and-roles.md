# SWFI Auth and Roles

Roles:

- `public_preview`: curated top-level dashboard data only.
- `subscriber`: SWFI-authenticated platform user.
- `swfi_operator`: internal operator with read access to approved service endpoints.
- `content_approver`: KP or delegated SWFI content approver.
- `data_owner`: SWFI data owner for canonical record corrections.
- `admin`: human-only access-control operator.

Rules:

- No custom dashboard auth for Phase 1 preview.
- Existing SWFI auth handles gated record access.
- Agent tools use dedicated SWFI service credentials, never ActiveMirror credentials.
- Public dashboard links hand off to SWFI sign-in with intended record redirect preserved.
- Agents must not extract browser-saved passwords or cookies for autonomous production access.
