#!/usr/bin/env node
// Regression test: the Institutions ("profiles") records / data-view table must
// default to AUM descending, not Entity-Name ascending — KP/Jaykesh feedback
// 2026-07-07/13. Guards against a silent revert of @/lib/recordSort.
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

// 1. The client-facing default: the "Top Ranked AUM" table leads with AUM
//    descending. profiles columns are ["Entity Name","Type","Country","AUM"],
//    so the AUM column is index 3.
check("defaultSortColumn(profiles)", defaultSortColumn("profiles"), 3);
check("defaultSortDir(profiles)", defaultSortDir("profiles"), "desc");

// 2. Allocators keep their most-recent-activity default (column 6, descending).
check("defaultSortColumn(allocators)", defaultSortColumn("allocators"), 6);
check("defaultSortDir(allocators)", defaultSortDir("allocators"), "desc");

// 3. News / intelligence expose Published at column 1 and lead newest-first.
for (const kind of ["research", "intelligence"]) {
  check(`defaultSortColumn(${kind})`, defaultSortColumn(kind), 1);
  check(`defaultSortDir(${kind})`, defaultSortDir(kind), "desc");
}

// 4. Every other record kind keeps the name-ascending default.
for (const kind of ["people", "transactions", "deals", "comparisons", "mandates", "alerts", "search"]) {
  check(`defaultSortColumn(${kind})`, defaultSortColumn(kind), 0);
  check(`defaultSortDir(${kind})`, defaultSortDir(kind), "asc");
}

// 5. AUM magnitudes order correctly and "Not disclosed" is non-numeric so it
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
    "profiles default sort = AUM column (3) descending",
    "allocators default sort = most-recent-activity (6) descending",
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
  console.log("PASS record-sort-defaults: profiles -> AUM desc; allocators -> activity desc; others -> name asc; AUM magnitudes ordered.");
  process.exit(0);
}
console.error("FAIL record-sort-defaults:\n" + failures.map((f) => "  - " + f).join("\n"));
process.exit(1);
