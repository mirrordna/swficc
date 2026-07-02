# Release Validation Script

Use this message format when sharing a candidate build for testing.

## Short Team Message

```text
The current /swficc dashboard validation build is deployed:
https://swfipn.activemirror.ai/swficc/

Completed in this build:
- Dashboard copy cleanup to remove internal/source-debug style wording.
- Institution Intelligence Overview with visual summaries.
- Total institutions by entity type.
- Top Active Investors for the recent activity window.
- Recently Fundraising Institutions.
- Investment trends by industry/category.
- Client validation documentation pack.

Please validate:
- Public dashboard load and SWFI look/feel.
- Dashboard visuals and section expansion.
- Search and discovery.
- Row/link navigation behavior.
- Absence of internal technical language.
- Whether this now feels like an insight layer rather than a raw table/database view.

Known boundary:
- This is the current dashboard validation scope, not a claim that full Phase 2 product acceptance is complete.
```

## Demo Flow

1. Open `https://swfipn.activemirror.ai/swficc/`.
2. Confirm SWFI branding, navigation, and search are visible.
3. Review the KPI rail.
4. Open `Institution Intelligence Overview`.
5. Point out:
   - Total Institutions Tracked by Entity Type,
   - Top Active Investors,
   - Recently Fundraising Institutions,
   - Investment Trends by Industry / Category.
6. Expand another dashboard section.
7. Use search.
8. Click one entity/investor row.
9. Check that no internal diagnostic language is visible.
10. Capture feedback against the validation checklist.

## Release Note Fields

For each release, record:

- release date,
- public URL,
- git commit,
- deployed release path,
- key changes,
- workflows ready for validation,
- known caveats,
- receipt paths.
