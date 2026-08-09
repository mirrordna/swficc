#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-msci-email-complaint-gate-latest.json");
const runDir = path.join(outputDir, "msci-email-complaint-gate-runs");
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(runDir, { recursive: true });

const { businessSearchQueryVariants } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/searchRelevance.ts")).href
);
const { emptyMandateFilters, mandateSourceEndpoint, normalizeMandateFilters } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/mandateSourceContract.ts")).href
);
const { allocatorSourceEndpoint, normalizeAllocatorFilters } = await import(
  pathToFileURL(path.join(repoRoot, "src/lib/allocatorSourceContract.ts")).href
);

const pageSource = fs.readFileSync(path.join(repoRoot, "src/app/page.tsx"), "utf8");
const searchSource = fs.readFileSync(path.join(repoRoot, "src/components/SearchResultsPage.tsx"), "utf8");
const sourceList = fs.readFileSync(path.join(repoRoot, "src/components/SourceListPage.tsx"), "utf8");
const aumContract = fs.readFileSync(path.join(repoRoot, "src/lib/aumRankingContract.ts"), "utf8");
const comparisonContract = fs.readFileSync(path.join(repoRoot, "src/lib/comparisonSourceContract.ts"), "utf8");
const dashboardContractGate = fs.readFileSync(path.join(repoRoot, "scripts/swfipn-dashboard20-e2e-contract-gate.mjs"), "utf8");
const performanceGate = fs.readFileSync(path.join(repoRoot, "scripts/swfipn-brd-performance-gate.mjs"), "utf8");

const mandateFilters = {
  ...emptyMandateFilters(),
  recordType: "opportunity",
  country: "United States",
  region: "North America",
  postedFrom: "2026-08-01",
  postedTo: "2026-08-31",
  dueFrom: "2026-09-01",
  dueTo: "2026-10-31",
  investmentTypes: ["Infrastructure"],
};
const mandateEndpoint = new URL(mandateSourceEndpoint(mandateFilters, 25, 0, "energy transition"), "https://dashboard.swfi.com");
const allocatorEndpoint = new URL(allocatorSourceEndpoint({
  country: "United States",
  region: "North America",
  entityType: "Public Pension",
  aumMin: "1000000",
  aumMax: "5000000",
}), "https://dashboard.swfi.com");

const checks = [
  {
    id: "top_ranked_aum_is_visible_and_source_bound",
    ok: pageSource.includes("Top Ranked AUM")
      && pageSource.includes("Ranked by comparable USD AUM from the verified source")
      && pageSource.includes("text(row.aum_usd")
      && pageSource.includes("AUM date not disclosed")
      && aumContract.includes("/v1/swfi/top20?"),
    expected: "The dashboard visibly names Top Ranked AUM, displays the contract-approved comparable USD value, labels source-date absence, and binds to the canonical ranking endpoint.",
  },
  {
    id: "home_kpis_have_executable_visible_semantics",
    ok: pageSource.includes('data-display-id={`home-kpi-${label.toLowerCase()')
      && pageSource.includes("{explain ? <div")
      && dashboardContractGate.includes('{ page: "/", contract: true'),
    expected: "Home KPI explanations are visible and the Dashboard 2.0 contract gate requires home display-contract elements.",
  },
  {
    id: "home_primary_sources_are_prioritized_without_legacy_mandate_duplicate",
    ok: pageSource.includes('const DASHBOARD_PRIMARY_LOAD_ORDER: PacketKey[] = ["metrics", "rfps", "transactions30", "entities"]')
      && pageSource.includes('data-dashboard-primary-ready={dashboardPrimaryReady ? "true" : "false"}')
      && pageSource.includes("for (const keys of [DASHBOARD_PRIMARY_LOAD_ORDER, DASHBOARD_SECONDARY_LOAD_ORDER])")
      && pageSource.includes("loadDashboardPackets((key, packet) =>")
      && pageSource.includes("controller.abort()")
      && pageSource.includes("{ attempts: dashboardAttempts(key), signal }")
      && performanceGate.includes("[data-dashboard-ready=\"true\"]")
      && performanceGate.includes("dashboard_primary_tti_ms")
      && !pageSource.includes('mandates: "/api/live-mandates/v1?limit=25&page=1"'),
    expected: "The four source packets needed for first use load before secondary analytics, navigation aborts the superseded fan-out, the governed combined RFP/Opportunity packet replaces the redundant legacy mandate fetch, and performance still requires full dashboard readiness.",
  },
  {
    id: "home_combined_compass_rows_use_canonical_type_partition",
    ok: pageSource.includes('function compassRecordType(row: Record<string, unknown>): "rfp" | "opportunity" | ""')
      && pageSource.includes("row.type || row.record_type || row.opportunity_type")
      && pageSource.includes('if (value === "rfp") return "rfp"')
      && pageSource.includes('if (!value || value === "not disclosed") return ""')
      && pageSource.includes('return "opportunity"'),
    expected: "Homepage RFP and Opportunity tabs give canonical row.type precedence over legacy aliases: exact RFP versus every disclosed non-RFP source type, while excluding undisclosed values.",
  },
  {
    id: "canonical_entity_type_is_exact_source_filter",
    ok: comparisonContract.includes('params.set("entity_type_match", "exact")')
      && comparisonContract.includes('cleanText(filters.entity_type_match) !== "exact"')
      && sourceList.includes('entityTypes: "/api/institution-types/v1?limit=100"')
      && sourceList.includes("Entity type (exact)")
      && sourceList.includes("Source count and pagination use the same exact predicate")
      && !sourceList.includes("upstream total remains broad-match"),
    expected: "The Institutions/Entities control is restricted to source-provided canonical types and requests coherent exact count/pagination semantics.",
  },
  {
    id: "mandate_record_type_geography_and_explicit_dates_are_source_bound",
    ok: mandateEndpoint.pathname === "/api/live-opportunities/v1"
      && mandateEndpoint.searchParams.get("record_type") === "opportunity"
      && mandateEndpoint.searchParams.get("q") === "energy transition"
      && mandateEndpoint.searchParams.get("country") === "United States"
      && mandateEndpoint.searchParams.get("region") === "North America"
      && mandateEndpoint.searchParams.get("posted_from") === "2026-08-01"
      && mandateEndpoint.searchParams.get("posted_to") === "2026-08-31"
      && mandateEndpoint.searchParams.get("due_from") === "2026-09-01"
      && mandateEndpoint.searchParams.get("due_to") === "2026-10-31"
      && mandateEndpoint.searchParams.get("investment_type") === "Infrastructure"
      && sourceList.includes("There is no undefined Period filter.")
      && sourceList.includes('data-primary-cta="Source-type, investment-type, and region bars open exact source-filtered records"')
      && !sourceList.includes("type and region remain display-only")
      && !sourceList.includes("does not accept a record-type filter")
      && !sourceList.includes("does not accept a region filter"),
    expected: "RFP/Opportunity selection and the approved exact geography and posted/due date fields compose on the combined source route without inventing Period semantics.",
  },
  {
    id: "mandate_date_validation_fails_closed",
    ok: normalizeMandateFilters({ ...emptyMandateFilters(), postedFrom: "2026-08-32" }).ok === false
      && normalizeMandateFilters({ ...emptyMandateFilters(), dueFrom: "2026-10-02", dueTo: "2026-10-01" }).ok === false,
    expected: "Malformed and reversed explicit date bounds fail before a source request is applied.",
  },
  {
    id: "allocator_approved_filters_are_source_bound",
    ok: allocatorEndpoint.pathname === "/api/allocator-activity/v1"
      && allocatorEndpoint.searchParams.get("country") === "United States"
      && allocatorEndpoint.searchParams.get("region") === "North America"
      && allocatorEndpoint.searchParams.get("entity_type") === "Public Pension"
      && allocatorEndpoint.searchParams.get("aum_min") === "1000000"
      && allocatorEndpoint.searchParams.get("aum_max") === "5000000"
      && sourceList.includes("AUM bounds exclude non-USD and undisclosed AUM; no FX conversion is applied."),
    expected: "Approved allocator geography/entity filters and disclosed-USD AUM bounds are sent exactly and the no-FX scope is visible.",
  },
  {
    id: "allocator_aum_validation_fails_closed",
    ok: normalizeAllocatorFilters({ aumMin: "-1" }).ok === false
      && normalizeAllocatorFilters({ aumMin: "5000001", aumMax: "5000000" }).ok === false,
    expected: "Negative or reversed allocator AUM bounds fail before a source request is applied.",
  },
  {
    id: "adia_news_queries_full_name_and_acronym",
    ok: JSON.stringify(businessSearchQueryVariants("ADIA")) === JSON.stringify(["ADIA", "Abu Dhabi Investment Authority"])
      && JSON.stringify(businessSearchQueryVariants("Abu Dhabi Investment Authority")) === JSON.stringify(["Abu Dhabi Investment Authority", "ADIA"]),
    observed: {
      acronym: businessSearchQueryVariants("ADIA"),
      full_name: businessSearchQueryVariants("Abu Dhabi Investment Authority"),
    },
  },
  {
    id: "hkic_news_queries_full_name_and_acronym",
    ok: JSON.stringify(businessSearchQueryVariants("HKIC")) === JSON.stringify(["HKIC", "Hong Kong Investment Corporation"])
      && JSON.stringify(businessSearchQueryVariants("Hong Kong Investment Corporation")) === JSON.stringify(["Hong Kong Investment Corporation", "HKIC"]),
    observed: {
      acronym: businessSearchQueryVariants("HKIC"),
      full_name: businessSearchQueryVariants("Hong Kong Investment Corporation"),
    },
  },
  {
    id: "smart_search_runs_all_news_query_variants",
    ok: searchSource.includes("businessSearchQueryVariants(currentQuery).map")
      && searchSource.includes("newsPackets.flatMap"),
    expected: "All-category Smart Search queries both the submitted institution name and its verified acronym/name alias, then deduplicates the returned news.",
  },
  {
    id: "known_multi_word_gap_not_presented_as_acceptable",
    ok: !sourceList.includes("multi-word news search is a known upstream gap"),
    expected: "The product must not normalize a known search defect into user-facing acceptance copy.",
  },
  {
    id: "active_allocators_approved_handoff_preserved",
    ok: sourceList.includes('kind === "allocators" ? "https://www.swfi.com/v1/signin/?msg=auth" : dataViewHref'),
    expected: "Active Allocators keeps the approved SWFI sign-in handoff and is not misclassified as a broken redirect.",
  },
];

const failures = checks.filter((check) => !check.ok).map((check) => check.id);
const receipt = {
  schema_version: "swfipn.msci_email_complaint_gate.v1",
  status: failures.length ? "fail" : "pass",
  generated_at: new Date().toISOString(),
  checked_scope: [
    "Top Ranked AUM visible source binding",
    "Home KPI visible and executable semantics",
    "Home source-load priority and combined RFP/Opportunity request reuse",
    "Home combined Compass packet canonical RFP/Opportunity partition",
    "Canonical exact entity-type filter/count/pagination contract",
    "RFP versus Opportunity, exact geography, posted/due date, and text-query contracts",
    "Allocator exact geography/entity-type and disclosed-USD AUM contracts",
    "ADIA entity-name/acronym news query coverage",
    "Hong Kong Investment Corporation/HKIC news query coverage",
    "Smart Search multi-source result merge",
    "Active Allocators approved sign-in handoff",
  ],
  unchecked_scope: [
    "live production rendering",
    "live production source contents",
    "live production latency",
    "MSCI customer ETL execution",
  ],
  source_feedback: {
    latest_relevant_email_date: "2026-08-06",
    dashboard_testing_email_date: "2026-07-31",
  },
  checks,
  failures,
  bad_news: failures.length
    ? ["At least one emailed complaint remains unbound in the candidate source."]
    : ["This is a source-level gate, not production proof."],
  remaining_risks: [
    "Production is unchanged until independent review, staging proof, explicit production approval, deployment, and fresh live complaint-level receipts.",
  ],
};

const immutableReceiptPath = path.join(runDir, `${receipt.generated_at.replace(/[:.]/g, "-")}.json`);
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
fs.writeFileSync(immutableReceiptPath, serialized, { flag: "wx" });
fs.writeFileSync(receiptPath, serialized);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, immutable_receipt: immutableReceiptPath, failures }, null, 2));
if (failures.length) process.exitCode = 1;
