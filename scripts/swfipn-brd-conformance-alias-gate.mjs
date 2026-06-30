#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-brd-conformance-alias-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const apiOrigin = new URL(origin).origin;

const routeChecks = [
  { id: "compass_route", route: "/compass/", expectedText: "RFPs / Mandates" },
  { id: "aggregates_route", route: "/aggregates/", expectedText: "Aggregates" },
  { id: "news_route", route: "/news/", expectedText: "Intelligence" },
  { id: "account_route", route: "/account/", expectedText: "SWFI Account" },
];

const collectionChecks = [
  { id: "transactions_alias", collection: "transactions", minCount: 180_000 },
  { id: "deals_alias", collection: "deals", minCount: 180_000 },
  { id: "mandates_alias", collection: "mandates", minCount: 30 },
  { id: "rfps_alias", collection: "rfps", minCount: 30 },
  { id: "news_alias", collection: "news", minCount: 10 },
  { id: "allocators_alias", collection: "allocators", minCount: 1 },
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function routeUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "text/html" } });
  return { status: response.status, text: await response.text() };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "X-SWFIPN-Public": "1" } });
  const text = await response.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { parse_error: text.slice(0, 160) };
  }
  return { status: response.status, json };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const checks = [];

  for (const spec of routeChecks) {
    const url = routeUrl(spec.route);
    const result = await fetchText(url).catch((error) => ({ status: 0, text: String(error?.message || error) }));
    checks.push({
      id: spec.id,
      route: spec.route,
      url,
      status: result.status,
      ok: result.status === 200 && result.text.includes(spec.expectedText),
      expected_text: spec.expectedText,
    });
  }

  for (const spec of collectionChecks) {
    const url = new URL(`/api/source-data/search/v1?collection=${encodeURIComponent(spec.collection)}&limit=1&page=1`, apiOrigin).href;
    const result = await fetchJson(url).catch((error) => ({ status: 0, json: { error: String(error?.message || error) } }));
    const count = typeof result.json?.data?.count === "number" ? result.json.data.count : 0;
    checks.push({
      id: spec.id,
      collection: spec.collection,
      url,
      status: result.status,
      packet_status: result.json?.status || "",
      count,
      ok: result.status === 200 && result.json?.status === "ok" && count >= spec.minCount,
      min_count: spec.minCount,
    });
  }

  const failures = checks.filter((check) => !check.ok);
  const receipt = {
    schema_version: "swfipn.brd_conformance_alias_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    api_origin: apiOrigin,
    status: failures.length ? "fail" : "pass",
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failures: failures.length, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ schema_version: "swfipn.brd_conformance_alias_gate.v1", status: "fail", error: String(error?.stack || error) }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
