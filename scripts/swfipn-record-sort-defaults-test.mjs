#!/usr/bin/env node
// Regression test: each records/data-view table must preserve its approved,
// source-backed default order. Cross-currency AUM sorting is intentionally
// unavailable because the entity source does not provide an FX contract.
// Run: node --experimental-strip-types scripts/swfipn-record-sort-defaults-test.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const { defaultSortColumn, defaultSortDir } = await import(
  pathToFileURL(path.join(cwd, "src/lib/recordSort.ts")).href
);
const { numericSortValue } = await import(
  pathToFileURL(path.join(cwd, "src/lib/sourcePackets.ts")).href
);

const failures = [];
function check(name, actual, expected) {
  if (actual !== expected) {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// 1. Institutions are a directory. AUM values retain their source currencies,
//    so the records table defaults to Entity Name ascending. The separately
//    contract-gated Top-Ranked AUM surface owns the canonical AUM ranking.
check("defaultSortColumn(profiles)", defaultSortColumn("profiles"), 0);
check("defaultSortDir(profiles)", defaultSortDir("profiles"), "asc");

// 2. Allocators use the approved completed buyer/acquirer ranking: Number of
//    Deals (column 4) descending, with source-side value/date tie-breakers.
check("defaultSortColumn(allocators)", defaultSortColumn("allocators"), 4);
check("defaultSortDir(allocators)", defaultSortDir("allocators"), "desc");

// 3. Recent transactions lead with Closed At (column 8) newest-first.
check("defaultSortColumn(transactions)", defaultSortColumn("transactions"), 8);
check("defaultSortDir(transactions)", defaultSortDir("transactions"), "desc");

// 4. Open RFPs / Opportunities lead with Deadline (column 5) soonest-first.
check("defaultSortColumn(mandates)", defaultSortColumn("mandates"), 5);
check("defaultSortDir(mandates)", defaultSortDir("mandates"), "asc");

// 5. News / intelligence expose Published at column 1 and lead newest-first.
for (const kind of ["research", "intelligence"]) {
  check(`defaultSortColumn(${kind})`, defaultSortColumn(kind), 1);
  check(`defaultSortDir(${kind})`, defaultSortDir(kind), "desc");
}

// 6. Every remaining record kind keeps the name-ascending default.
for (const kind of ["people", "deals", "comparisons", "alerts", "search"]) {
  check(`defaultSortColumn(${kind})`, defaultSortColumn(kind), 0);
  check(`defaultSortDir(${kind})`, defaultSortDir(kind), "asc");
}

// 7. AUM magnitudes parse correctly and "Not disclosed" is non-numeric so it
//    sinks to the bottom of a descending sort (compareCells relies on this).
const aum139B = numericSortValue("$139.8B");
const aum380M = numericSortValue("$380.1M");
const aum122M = numericSortValue("$122.8M");
if (!(aum139B > aum380M)) failures.push(`AUM order: $139.8B (${aum139B}) should outrank $380.1M (${aum380M})`);
if (!(aum380M > aum122M)) failures.push(`AUM order: $380.1M (${aum380M}) should outrank $122.8M (${aum122M})`);
check("numericSortValue(Not disclosed)", numericSortValue("Not disclosed"), null);

const passed = failures.length === 0;
const receipt = {
  schema_version: "swfipn.record_sort_defaults_test.v1",
  ok: passed,
  failures,
  checked: [
    "profiles directory default sort = Entity Name (0) ascending; cross-currency AUM sort withheld",
    "allocators default sort = Number of Deals (4) descending",
    "transactions default sort = Closed At (8) descending",
    "mandates default sort = Deadline (5) ascending",
    "research and intelligence default sort = Published column (1) descending",
    "remaining kinds default = name (0) ascending",
    "AUM magnitude ordering ($139.8B > $380.1M > $122.8M) and Not disclosed = null",
  ],
};
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "swfipn-record-sort-defaults-test-latest.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);

if (passed) {
  console.log("PASS record-sort-defaults: directory, allocator, transaction, mandate, and publication defaults match their source contracts.");
  process.exit(0);
}
console.error("FAIL record-sort-defaults:\n" + failures.map((f) => "  - " + f).join("\n"));
process.exit(1);
