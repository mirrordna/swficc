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

const pageSource = fs.readFileSync(path.join(repoRoot, "src/app/page.tsx"), "utf8");
const searchSource = fs.readFileSync(path.join(repoRoot, "src/components/SearchResultsPage.tsx"), "utf8");
const sourceList = fs.readFileSync(path.join(repoRoot, "src/components/SourceListPage.tsx"), "utf8");
const aumContract = fs.readFileSync(path.join(repoRoot, "src/lib/aumRankingContract.ts"), "utf8");

const checks = [
  {
    id: "top_ranked_aum_is_visible_and_source_bound",
    ok: pageSource.includes("Top Ranked AUM") && aumContract.includes("/v1/swfi/top20?"),
    expected: "The dashboard visibly names Top Ranked AUM and binds it to the canonical ranking endpoint.",
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
