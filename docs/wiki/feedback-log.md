# Feedback Log

Last updated: 2026-07-04

This page summarizes accepted feedback themes. It is not a replacement for the live requirements document.

## 2026-07 Process Reset Feedback

### Purpose Of Meeting

The meeting was to review current SWFI dashboard development status, resolve confusion caused by multiple competing versions and requirement documents, agree on the correct working version, clarify the development process going forward, and identify immediate fixes and next steps.

The meeting focused on:

- reverting to the preferred working dashboard version,
- establishing a single source of truth for requirements,
- clarifying navigation, login behavior, search, and visualization rules,
- preventing conflicting instructions from multiple stakeholders,
- assigning ownership of the live requirements document,
- identifying specific technical and design fixes.

### Multiple Version Confusion

The team acknowledged that multiple dashboard versions caused confusion. Different backend and frontend versions were mixed, and multiple stakeholder documents or comments were sent independently.

Main conclusion:

```text
The team needs one aligned dashboard version, one working requirements document, and one coordinated instruction flow.
```

### Practical Impact

Going forward:

- do not build from several unofficial wish lists at once,
- do not ask Paul/Codex to reconcile conflicting instructions silently,
- do not validate against old and new links interchangeably,
- do not add self-directed features during acceptance,
- every release must identify what changed and what should be validated.

## Dashboard Feedback Themes

### Information Presentation

The dashboard should not simply expose database records. It should surface meaningful insights and guide users into SWFI workflows.

### Information Visualization

The dashboard should translate data into useful visual formats such as charts, maps, rankings, comparisons, trends, and heatmaps where appropriate.

### Navigation Paths

Dashboard elements should ultimately lead users to the correct SWFI platform workflow or record. Avoid confusing parallel pages unless the requirement explicitly calls for them.

### Dashboard Login And Access Flow

The initial dashboard should not require login. It should provide only a limited preview of SWFI data.

When users want to go deeper:

- unauthenticated users should be redirected through SWFI's existing login/authentication flow,
- the login flow should preserve the intended destination,
- authenticated users should be forwarded to the relevant SWFI platform page,
- the transition should feel like one SWFI platform experience.

There was concern that the first dashboard-to-SWFI authentication redirect can be slow. Current understanding: this may be a one-time operational issue and is not a reason to change the Phase 1 auth principle unless the requirements owner changes the contract.

### Not A Blind Database Dump

The dashboard should not expose or dump the entire database. The desired direction is a controlled preview that presents data visually, meaningfully, and in a customer-friendly way.

Decision:

```text
The dashboard should remain a limited, curated preview of SWFI data, not a full database dump.
```

### Search Bar And Autocomplete

The search bar is an immediate blocker area.

Examples raised:

- `PIF` did not return the expected result,
- `Abu Dhabi` did not prioritize expected entities,
- `Zurich Insurance Group` did not work consistently,
- some links and results appeared incomplete or nonfunctional.

Autocomplete should not be strict alphabetical search. It should follow a business/customer hierarchy. Jaykesh is expected to provide the final ordering list. Interim priority: exact match, recognized institutional acronym/synonym, sovereign wealth fund, pension fund, government fund/investment authority, then other relevant records.

### Copy And Language

The copy should be external-facing, business-facing, and SWFI-aligned. It should not expose internal engineering terms, debug labels, or implementation details.
