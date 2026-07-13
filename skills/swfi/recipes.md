# SWFI Recipes

## Read Institution Profile

1. Use `get_institution_profile`.
2. Verify caller role.
3. Return whitelisted fields only.
4. Include provenance and query receipt.
5. Route gated deep links through SWFI sign-in handoff.

## Propose Data Correction

1. Collect source evidence.
2. Compare current value, proposed value, source, and effective date.
3. Create `propose_record_correction`.
4. Mark status `needs_review`.
5. Do not write canonical collection.

## Create Content Draft

1. Gather source-backed facts.
2. Keep synthesis separate from facts.
3. Create draft only.
4. Request approval.
5. Do not publish or send externally.
