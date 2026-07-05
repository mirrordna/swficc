# Codex Prompt: Prosecutor Pass

You are the final acceptance prosecutor for the `/swficc` dashboard/demo surface. Do not trust the builder pass.

Try to find any blocker that could cause Premjit, KP, Michael, QA, or a stakeholder to reject the current acceptance/demo surface.

Criteria:
1. Dashboard look/feel is consistent with SWFI.
2. Public `/swficc` dashboard renders without login.
3. Unauthenticated dashboard record hyperlinks redirect to SWFI sign-in with the intended `/v1/...` target preserved.
4. Authenticated dashboard record hyperlinks route to the corresponding SWFI core platform record/profile page after SWFI authentication.
5. No internal technical details are visible.
6. Table rows link to correct SWFI record/profile pages.
7. Public API/frontend payloads do not expose restricted/private/internal data.
8. Missing/empty data renders cleanly.
9. Mobile/tablet/desktop layout does not break.
10. Existing gate receipts remain passing.

If a finding is inside scope, classify as blocker or non-blocker. If it is outside scope, classify as Phase 2. Do not perform more than one prosecutor pass without new external evidence.

Final permitted sentence:

“No blockers found within the current `/swficc` acceptance/demo scope. Remaining comments, if any, are Phase 2 or change-request items.”
