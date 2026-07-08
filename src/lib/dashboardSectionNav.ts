// One section nav, one vocabulary, every dashboard page. Before 2026-07-08
// three components carried their own copies and drifted: reports and research
// pages were missing Active Allocators and AUM History entirely.
// Minutes F: no nav element without working function — Alerts stays out until
// its data source is real. AUM History added 2026-07-06 (Paul: "link it").
// Vocabulary note: home's sidebar uses the minutes M-1 wording
// ("Contacts & Relationships", "Deals & Pipelines" -> /transactions), while
// this nav uses the KP acceptance-contract wording, where "Deals" -> /deals.
// Reconciling the two vocabularies is an open one-line team ruling recorded
// in docs/TEAM_RESOLUTION_PLAN_2026-07-08.md.
export const DASHBOARD_SECTION_NAV = [
  ["Dashboard", "/"],
  ["Institutions", "/profiles"],
  ["People", "/people"],
  ["Deals", "/deals"],
  ["Active Allocators", "/allocators"],
  ["Comparisons", "/comparisons"],
  ["RFPs", "/mandates"],
  ["AUM History", "/aggregates"],
  ["Reports", "/reports"],
  ["Intelligence", "/intelligence"],
  ["Search", "/search"],
] as const;
