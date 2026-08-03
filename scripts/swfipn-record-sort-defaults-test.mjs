#!/usr/bin/env node
// Regression test: source-reported AUM may use different currencies, so record
// directories must not present it as one comparable ranking.
// Run: node --experimental-strip-types scripts/swfipn-record-sort-defaults-test.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const { defaultSortColumn, defaultSortDir, isSortableRecordColumn } = await import(
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

// 1. Institution directories lead by name and disclose that native/source AUM
//    is not a sortable cross-currency measure.
check("defaultSortColumn(profiles)", defaultSortColumn("profiles"), 0);
check("defaultSortDir(profiles)", defaultSortDir("profiles"), "asc");
check("isSortableRecordColumn(profiles,AUM)", isSortableRecordColumn("profiles", "Source-reported AUM"), false);
check("isSortableRecordColumn(comparisons,AUM)", isSortableRecordColumn("comparisons", "Source-reported AUM"), false);
check("isSortableRecordColumn(allocators,AUM)", isSortableRecordColumn("allocators", "AUM"), false);

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

// 5. Numeric parsing remains available for homogeneous-currency uses, while
//    the UI contract above prevents mixed currencies from entering one rank.
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
    "profiles default sort = Entity Name column (0) ascending",
    "source-reported AUM columns are not sortable across currencies",
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
  console.log("PASS record-sort-defaults: source AUM is non-rankable; profiles -> name asc; allocators -> activity desc; remaining defaults preserved.");
  process.exit(0);
}
console.error("FAIL record-sort-defaults:\n" + failures.map((f) => "  - " + f).join("\n"));
process.exit(1);
