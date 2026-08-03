#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  balanceSearchResultRows,
  searchResultCategoryCounts,
  searchResultRecordType,
  visibleSearchResultRows,
} from "../src/lib/searchResultPresentation.ts";
import { collectFactPacketsProgressively } from "../src/lib/sourcePackets.ts";

const rows = [
  ...Array.from({ length: 20 }, (_, index) => ({ __searchCategory: "entities", name: `Entity ${index}` })),
  ...Array.from({ length: 3 }, (_, index) => ({ __searchCategory: "transactions", name: `Transaction ${index}` })),
  ...Array.from({ length: 8 }, (_, index) => ({ __searchCategory: "opportunities", name: `Opportunity ${index}` })),
  ...Array.from({ length: 2 }, (_, index) => ({ __searchCategory: "news", name: `News ${index}` })),
  { __searchCategory: "people", name: "Person 0" },
];

const balanced = balanceSearchResultRows(rows, 5);
const balancedCounts = searchResultCategoryCounts(balanced);
assert.deepEqual(balanced.slice(0, 5).map((row) => row.__searchCategory), [
  "entities",
  "transactions",
  "opportunities",
  "news",
  "people",
]);
assert.deepEqual(balancedCounts, {
  all: 16,
  entities: 5,
  transactions: 3,
  opportunities: 5,
  news: 2,
  people: 1,
});
assert.ok(Math.max(...Object.values(balancedCounts).slice(1)) <= 5, "All results caps each category independently");

assert.equal(searchResultRecordType({ __searchCategory: "entities", type: "Sovereign Wealth Fund" }), "Sovereign Wealth Fund");
assert.equal(searchResultRecordType({ __searchCategory: "opportunities", type: "RFP" }), "RFP");
assert.equal(searchResultRecordType({ __searchCategory: "opportunities", type: "Opportunity" }), "Opportunity");
assert.equal(searchResultRecordType({ __searchCategory: "entities" }), "Not disclosed");
assert.equal(searchResultRecordType({ __searchCategory: "opportunities" }), "Not disclosed");
assert.equal(searchResultRecordType({ __searchCategory: "transactions", acquisition_type: "Acquisition" }), "Acquisition");
assert.equal(searchResultRecordType({ __searchCategory: "people" }), "Person");

const intentRows = Array.from({ length: 15 }, (_, index) => ({
  __searchCategory: "entities",
  name: `Pension ${index + 1}`,
}));
assert.equal(visibleSearchResultRows(intentRows, {
  allCategories: true,
  singleCategoryIntent: true,
  rowLimit: 10,
  perCategory: 5,
}).length, 10, "single-category semantic intents show the normal ten-row page");
assert.equal(visibleSearchResultRows(intentRows, {
  allCategories: true,
  singleCategoryIntent: false,
  rowLimit: 10,
  perCategory: 5,
}).length, 5, "generic All results retain the five-per-category balance cap");

const searchPageSource = readFileSync("src/components/SearchResultsPage.tsx", "utf8");
assert.match(searchPageSource, /useState\(10\)/, "category detail pages default to 10 rows");
assert.match(searchPageSource, /Rows per category/, "All results exposes the bounded per-category control");
assert.match(searchPageSource, /search-result-category-refinements/, "the detailed screen can refine category in place");
assert.match(searchPageSource, /searchResultRecordType\(categorizedRow\)/, "rows display source-specific record types");
assert.match(searchPageSource, /source-intelligence\/news\/v1\?q=/, "detailed news retrieval is bound to the active query");
assert.match(searchPageSource, /source-intelligence\/news\/v1\?q=.*limit=25/, "detailed news retrieval uses the bounded visible-result window");
assert.doesNotMatch(searchPageSource, /source-intelligence\/news\/v1\?q=.*limit=100/, "detailed news retrieval does not request an unused 100-row window");
assert.match(searchPageSource, /collectFactPacketsProgressively/, "detailed news retrieval publishes verified variants progressively");
assert.match(searchPageSource, /mergeSearchRecordsPreferEnriched/, "detailed entity results prefer source-enriched duplicate facts");
assert.match(searchPageSource, /search-source-freshness/, "detailed results expose the live source response timestamp");

const firstNews = deferred();
const failedVariant = deferred();
const progress = [];
const progressiveCollection = collectFactPacketsProgressively(
  [firstNews.promise, failedVariant.promise],
  (packet, index) => progress.push({ index, title: packet.data.rows[0].title }),
);
firstNews.resolve({ status: "ok", fact: true, data: { rows: [{ title: "Source-backed first result" }] } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(progress, [{ index: 0, title: "Source-backed first result" }], "a verified response is published before a slower variant settles");
failedVariant.resolve({ status: "unavailable", fact: false, unavailable_reason: "backend_fetch_aborted", data: { rows: [] } });
const progressivePackets = await progressiveCollection;
assert.equal(progressivePackets.length, 1, "a failed variant does not erase a verified response");
assert.equal(progressivePackets[0].data.rows[0].title, "Source-backed first result");
await assert.rejects(
  collectFactPacketsProgressively(
    [Promise.resolve({ status: "ok", fact: true, data: { rows: [] } })],
    () => { throw new Error("publisher regression"); },
  ),
  /publisher regression/,
  "publisher defects are not mislabeled as source gaps",
);

const routeProbe = execFileSync("python3", [
  "-c",
  [
    "import importlib.util, json, sys, urllib.parse",
    "spec = importlib.util.spec_from_file_location('swfipn_static', 'scripts/serve-static-with-headers.py')",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "handler = object.__new__(module.StaticProxyHandler)",
    "urls = json.loads(sys.argv[1])",
    "print(json.dumps([handler.is_search_results_path(urllib.parse.urlsplit(url)) for url in urls]))",
  ].join("; "),
  JSON.stringify([
    "/swficc/search/?q=ADIA",
    "/swficc/search/?q=Top%20Active%20Investors",
    "/swficc/search/?q=ADIA&category=transactions",
  ]),
], { encoding: "utf8" });
assert.deepEqual(JSON.parse(routeProbe), [false, false, false], "all detailed searches stay on the category-aware Next page");

console.log(JSON.stringify({
  status: "pass",
  evidence_class: "NOT_ACCEPTANCE",
  reason: "Synthetic rows and source assertions support implementation only; real SWFI-backed browser evidence is required for acceptance.",
  balanced_rows: balanced.length,
  route_cases: 3,
}));

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
