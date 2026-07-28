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

// KP feedback 2026-07-27 (WhatsApp, 8:12 PM): "Family office in Germany"
// fetched nothing, and Geography=Middle East + SWF filtered loaded rows to
// zero. These cases pin both repairs.
const germanyIntent = smartSearchIntentForQuery("Family office in Germany");
assert.ok(germanyIntent, "family office in Germany resolves an intent");
assert.equal(germanyIntent.id, "regional-institutions");
assert.equal(germanyIntent.category, "entities");
assert.deepEqual(germanyIntent.countries, ["Germany"]);
assert.ok(germanyIntent.requests.every((request) => request.endpoint.includes("entity_type=Family%20Office")));
assert.ok(germanyIntent.requests.every((request) => request.endpoint.includes("country=Germany")));
assert.deepEqual(
  filterSmartSearchIntentRows(germanyIntent, [
    { name: "Rhein Family Office", type: "Family Office", country: "Germany", source_url: "https://www.swfi.com/v1/entities/10" },
    { name: "Gulf Family Office", type: "Family Office", country: "United Arab Emirates", source_url: "https://www.swfi.com/v1/entities/11" },
    { name: "Berlin Bank", type: "Bank", country: "Germany", source_url: "https://www.swfi.com/v1/entities/12" },
    { name: "Unsourced FO", type: "Family Office", country: "Germany" },
  ]).map((row) => row.name),
  ["Rhein Family Office"],
  "country intent keeps only sourced rows in that country",
);

// KP's exact mobile phrasing had no "in": "Family office germany".
const germanyBareIntent = smartSearchIntentForQuery("Family office germany");
assert.ok(germanyBareIntent, "family office germany (no 'in') still resolves");
assert.deepEqual(germanyBareIntent.countries, ["Germany"]);

// City alias: Abu Dhabi resolves to the UAE country label.
const abuDhabiIntent = smartSearchIntentForQuery("Family offices in Abu Dhabi");
assert.ok(abuDhabiIntent);
assert.deepEqual(abuDhabiIntent.countries, ["United Arab Emirates"]);

// A bare country without an institutional noun stays on the normal path.
assert.equal(smartSearchIntentForQuery("Germany"), null, "bare country stays on the existing search path");

// Region intents must keep rows whose region field is absent but whose
// country belongs to the region (SWF + Middle East returned 0 of 50).
const middleEastSwfIntent = smartSearchIntentForQuery("Sovereign wealth funds in the Middle East");
assert.ok(middleEastSwfIntent);
assert.deepEqual(
  filterSmartSearchIntentRows(middleEastSwfIntent, [
    { name: "Abu Dhabi Investment Authority", type: "Sovereign Wealth Fund", country: "United Arab Emirates", source_url: "https://www.swfi.com/v1/entities/20" },
    { name: "Region-Tagged Fund", type: "Sovereign Wealth Fund", region: "Middle East", country: "Not disclosed", source_url: "https://www.swfi.com/v1/entities/21" },
    { name: "Nordic Fund", type: "Sovereign Wealth Fund", country: "Norway", region: "Europe", source_url: "https://www.swfi.com/v1/entities/22" },
  ]).map((row) => row.name),
  ["Abu Dhabi Investment Authority", "Region-Tagged Fund"],
  "region membership by country keeps rows that lack a region field",
);

console.log(JSON.stringify({ status: "pass", cases: cases.length, kp_feedback_cases: 6 }));
