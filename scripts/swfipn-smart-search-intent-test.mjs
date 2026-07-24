#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  filterSmartSearchIntentRows,
  intentRegion,
  smartSearchIntentForQuery,
} from "../src/lib/smartSearchIntent.ts";

const cases = [
  ["Top Active Investors", "active-investors", "entities", "allocator-activity/v1"],
  ["RFPs from the Middle East", "regional-opportunities", "opportunities", "live-opportunities/v1"],
  ["Sovereign Wealth Funds investing in AI", "institutional-theme-investments", "transactions", "buyer_type=Sovereign+Wealth+Fund"],
  ["Pension Funds in Europe", "regional-institutions", "entities", "collection=entities"],
  ["Family offices in MENA", "regional-institutions", "entities", "entity_type=Family%20Office"],
  ["Central banks in APAC", "regional-institutions", "entities", "entity_type=Central%20Bank"],
  ["Most active sovereign investors in the GCC", "active-investors", "entities", "allocator-activity/v1"],
  ["Open manager searches in EMEA", "regional-opportunities", "opportunities", "live-opportunities/v1"],
  ["Pension plans investing in healthcare in the last 90 days", "institutional-theme-investments", "transactions", "value=Healthcare"],
  ["Family offices deploying capital into real estate", "institutional-theme-investments", "transactions", "buyer_type=Family+Office"],
  ["SWFs with exposure to infrastructure", "institutional-theme-investments", "transactions", "value=Infrastructure"],
  ["Endowments investing in biotechnology", "institutional-theme-investments", "transactions", "value=Biotechnology"],
];

for (const [query, id, category, endpointNeedle] of cases) {
  const intent = smartSearchIntentForQuery(query);
  assert.ok(intent, `${query}: intent should resolve`);
  assert.equal(intent.id, id, `${query}: intent id`);
  assert.equal(intent.category, category, `${query}: category`);
  assert.ok(intent.requests.some((request) => request.endpoint.includes(endpointNeedle)), `${query}: source endpoint`);
}

assert.equal(intentRegion("central banks in APAC"), "APAC");
assert.equal(intentRegion("mandates in LATAM"), "Latin America");
assert.equal(smartSearchIntentForQuery("GIC"), null, "normal entity queries stay on the existing search path");
assert.equal(
  smartSearchIntentForQuery("Middle Eastern SWFs investing in AI"),
  null,
  "ambiguous buyer-domicile versus target-geography investment queries stay unresolved",
);

const pensionIntent = smartSearchIntentForQuery("Pension Funds in Europe");
assert.ok(pensionIntent);
assert.ok(pensionIntent.requests.every((request) => request.endpoint.includes("entity_type=Pension")));
assert.ok(pensionIntent.requests.every((request) => request.endpoint.includes("region=Europe")));
assert.ok(pensionIntent.requests.every((request) => !request.endpoint.includes("q=")));
assert.deepEqual(
  filterSmartSearchIntentRows(pensionIntent, [
    { name: "European Pension", type: "Public Pension", region: "Europe", source_url: "https://www.swfi.com/v1/entities/1" },
    { name: "Asian Pension", type: "Public Pension", region: "Asia", source_url: "https://www.swfi.com/v1/entities/2" },
    { name: "European Bank", type: "Bank", region: "Europe", source_url: "https://www.swfi.com/v1/entities/3" },
    { name: "Unsourced Pension", type: "Pension", region: "Europe" },
  ]).map((row) => row.name),
  ["European Pension"],
);

const apacCentralBankIntent = smartSearchIntentForQuery("Central banks in APAC");
assert.ok(apacCentralBankIntent);
assert.equal(apacCentralBankIntent.requests.length, 2);
assert.ok(apacCentralBankIntent.requests.some((request) => request.endpoint.includes("region=Asia")));
assert.ok(apacCentralBankIntent.requests.some((request) => request.endpoint.includes("region=Australia%20and%20Pacific")));
assert.deepEqual(
  filterSmartSearchIntentRows(apacCentralBankIntent, [
    { name: "Asian central bank", type: "Central Bank", region: "Asia", source_url: "https://www.swfi.com/v1/entities/4" },
    { name: "Australian central bank", type: "Central Bank", region: "Australia and Pacific", source_url: "https://www.swfi.com/v1/entities/5" },
    { name: "European central bank", type: "Central Bank", region: "Europe", source_url: "https://www.swfi.com/v1/entities/6" },
  ]).map((row) => row.name),
  ["Asian central bank", "Australian central bank"],
);

const swfAiIntent = smartSearchIntentForQuery("Sovereign Wealth Funds investing in AI");
assert.ok(swfAiIntent);
const swfAiRows = filterSmartSearchIntentRows(swfAiIntent, [{
  title: "AI deal",
  source_url: "https://www.swfi.com/v1/transactions/1",
  buyer_entities: [{ name: "Qatar Investment Authority", type: "Sovereign Wealth Fund" }, { name: "Co-investor", type: "Asset Manager" }],
}]);
assert.equal(swfAiRows.length, 1);
assert.deepEqual(swfAiRows[0].__smartSearchMatchedBuyers, ["Qatar Investment Authority"]);

const pensionHealthcareIntent = smartSearchIntentForQuery("Pension plans investing in healthcare in the last 90 days");
assert.ok(pensionHealthcareIntent);
assert.ok(pensionHealthcareIntent.requests.every((request) => request.endpoint.includes("days=90")));
assert.equal(filterSmartSearchIntentRows(pensionHealthcareIntent, [{
  title: "Healthcare deal",
  source_url: "https://www.swfi.com/v1/transactions/2",
  buyer_entities: [{ type: "Public Pension" }, { type: "Company" }],
}]).length, 1);

const pythonQueries = cases.map(([query]) => query);
const pythonProbe = execFileSync("python3", [
  "-c",
  [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('swfipn_static', 'scripts/serve-static-with-headers.py')",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "queries = json.loads(sys.argv[1])",
    "print(json.dumps([module.is_natural_language_intent_query(query) for query in queries]))",
  ].join("; "),
  JSON.stringify(pythonQueries),
], { encoding: "utf8" });
assert.deepEqual(JSON.parse(pythonProbe), pythonQueries.map(() => true), "static server routes every supported intent to the Next search app");

console.log(JSON.stringify({ status: "pass", cases: cases.length }));
