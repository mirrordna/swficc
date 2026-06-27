#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-api-product-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const defaultOrigin = "https://swfipn.activemirror.ai/swficc/";
const frontendOrigin = normalizeOrigin(process.env.SWFIPN_ORIGIN || defaultOrigin);
const apiOrigin = normalizeApiOrigin(
  process.env.SWFIPN_API_ORIGIN ||
    process.env.SWFIPN_BACKEND_ORIGIN ||
    new URL(frontendOrigin).origin
);
const apiKey = loadProductKey();

const forbiddenKeys = new Set([
  "_id",
  "source_collection",
  "truth_state",
  "result_qualifier",
  "source_gap",
  "source_gap_reason",
  "provenance",
  "internal_receipt",
  "backend_http",
  "backend_fetch",
]);
const forbiddenText = [
  "Active Mirror",
  "source_gap",
  "backend_http",
  "backend_fetch",
  "terminal_canonical_data",
  "SWFI2_API_TOKEN",
];

async function main() {
  const checks = [];
  checks.push(await checkDocs());
  checks.push(await checkUnauthenticatedBlock());
  if (apiKey) {
    checks.push(await checkListEndpoint("entities", "/v1/entities?limit=2&offset=0&q=Norway"));
    checks.push(await checkListEndpoint("people", "/v1/people?limit=1&offset=0"));
    checks.push(await checkListEndpoint("transactions", "/v1/transactions?limit=1&offset=0"));
    checks.push(await checkListEndpoint("compass", "/v1/compass?limit=1&offset=0"));
    checks.push(await checkListEndpoint("reports", "/v1/reports?limit=1&offset=0"));
    checks.push(await checkAggregates());
  } else {
    checks.push({
      name: "api_key_available",
      status: "fail",
      failures: ["missing_SWFIPN_API_PRODUCT_KEY_or_keychain_secret"],
    });
  }

  const failures = checks.flatMap((check) => check.failures.map((failure) => `${check.name}:${failure}`));
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.api_product_gate.v1",
    generated_at: new Date().toISOString(),
    status,
    frontend_origin: frontendOrigin,
    api_origin: apiOrigin,
    summary: {
      failures,
      checked_api_key: Boolean(apiKey),
      docs_status: checks.find((check) => check.name === "docs")?.status || "missing",
      unauthenticated_status: checks.find((check) => check.name === "unauthenticated_block")?.response_status || null,
      list_endpoint_statuses: Object.fromEntries(
        checks
          .filter((check) => check.name.startsWith("list_"))
          .map((check) => [check.collection, check.status])
      ),
      aggregates_status: checks.find((check) => check.name === "aggregates")?.status || "missing",
      rate_limit_runtime: "backend_pytest_429_receipt",
    },
    checks,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  if (status === "fail") process.exit(1);
}

async function checkDocs() {
  const failures = [];
  const response = await fetchJson("/docs");
  const body = response.body && typeof response.body === "object" ? response.body : {};
  const endpoints = Array.isArray(body.endpoints) ? body.endpoints : [];
  const endpointPaths = endpoints.map((endpoint) => endpoint.path).filter(Boolean);
  if (response.status !== 200) failures.push(`http_${response.status}`);
  if (body.status !== "ok") failures.push(`status_${body.status || "missing"}`);
  if (body.base_url !== "https://api.swfi.com") failures.push(`base_url_${body.base_url || "missing"}`);
  if (body.version !== "v1") failures.push(`version_${body.version || "missing"}`);
  if (body.format !== "json") failures.push(`format_${body.format || "missing"}`);
  if (body.authentication?.header !== "X-API-Key") failures.push("missing_x_api_key_doc");
  if (body.pagination?.style !== "limit_offset") failures.push("missing_limit_offset_doc");
  if (body.rate_limiting?.status_code !== 429) failures.push("missing_429_doc");
  for (const required of ["/v1/entities", "/v1/people", "/v1/transactions", "/v1/compass", "/v1/reports", "/v1/entities/aggregates"]) {
    if (!endpointPaths.includes(required)) failures.push(`missing_endpoint_${required}`);
  }
  failures.push(...leakFailures(body));
  return {
    name: "docs",
    status: failures.length ? "fail" : "pass",
    url: response.url,
    response_status: response.status,
    base_url: body.base_url || null,
    endpoint_count: endpointPaths.length,
    endpoint_paths: endpointPaths,
    failures,
  };
}

async function checkUnauthenticatedBlock() {
  const response = await fetchJson("/v1/entities?limit=1&offset=0");
  const failures = [];
  if (response.status !== 401) failures.push(`expected_401_got_${response.status}`);
  return {
    name: "unauthenticated_block",
    status: failures.length ? "fail" : "pass",
    url: response.url,
    response_status: response.status,
    failures,
  };
}

async function checkListEndpoint(collection, pathname) {
  const response = await fetchJson(pathname, { "X-API-Key": apiKey });
  const body = response.body && typeof response.body === "object" ? response.body : {};
  const items = Array.isArray(body.items) ? body.items : [];
  const failures = [];
  if (response.status !== 200) failures.push(`http_${response.status}`);
  if (body.status !== "ok") failures.push(`status_${body.status || "missing"}`);
  if (body.version !== "v1") failures.push(`version_${body.version || "missing"}`);
  if (body.collection !== collection) failures.push(`collection_${body.collection || "missing"}`);
  if (!items.length) failures.push("missing_items");
  if (!body.pagination || typeof body.pagination !== "object") failures.push("missing_pagination");
  if (typeof body.pagination?.limit !== "number") failures.push("missing_limit");
  if (typeof body.pagination?.offset !== "number") failures.push("missing_offset");
  if (typeof body.pagination?.total !== "number") failures.push("missing_total");
  if (!body.freshness || typeof body.freshness !== "object") failures.push("missing_freshness");
  if (body.freshness?.source !== "swfi_approved_data") failures.push(`freshness_source_${body.freshness?.source || "missing"}`);
  if (!body.rate_limit || typeof body.rate_limit !== "object") failures.push("missing_rate_limit");
  failures.push(...leakFailures(body));
  return {
    name: `list_${collection}`,
    collection,
    status: failures.length ? "fail" : "pass",
    url: response.url,
    response_status: response.status,
    item_count: items.length,
    pagination: body.pagination || null,
    first_item_keys: items[0] && typeof items[0] === "object" ? Object.keys(items[0]) : [],
    freshness: body.freshness || null,
    failures,
  };
}

async function checkAggregates() {
  const response = await fetchJson(
    "/v1/entities/aggregates?entity_class=pensions&region=all&smoothing=linear&start_year=1971",
    { "X-API-Key": apiKey }
  );
  const body = response.body && typeof response.body === "object" ? response.body : {};
  const points = Array.isArray(body.points) ? body.points : [];
  const rawPoints = Array.isArray(body.raw_points) ? body.raw_points : [];
  const failures = [];
  if (response.status !== 200) failures.push(`http_${response.status}`);
  if (body.status !== "ok") failures.push(`status_${body.status || "missing"}`);
  if (body.collection !== "entities_aggregates") failures.push(`collection_${body.collection || "missing"}`);
  if (!points.length) failures.push("missing_points");
  if (!rawPoints.length) failures.push("missing_raw_points");
  if (body.freshness?.source !== "swfi_approved_data") failures.push(`freshness_source_${body.freshness?.source || "missing"}`);
  failures.push(...leakFailures(body));
  return {
    name: "aggregates",
    status: failures.length ? "fail" : "pass",
    url: response.url,
    response_status: response.status,
    point_count: points.length,
    raw_point_count: rawPoints.length,
    parameters: body.parameters || null,
    failures,
  };
}

async function fetchJson(pathname, headers = {}) {
  const url = new URL(pathname, apiOrigin).href;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text || "null");
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return {
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    text_preview: text.slice(0, 500),
  };
}

function leakFailures(value) {
  const failures = [];
  const keys = [];
  collectKeys(value, keys);
  for (const key of keys) {
    if (forbiddenKeys.has(key)) failures.push(`forbidden_key_${key}`);
  }
  const text = JSON.stringify(value);
  for (const needle of forbiddenText) {
    if (text.includes(needle)) failures.push(`forbidden_text_${needle.replaceAll(" ", "_")}`);
  }
  return failures;
}

function collectKeys(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    keys.push(key);
    collectKeys(nested, keys);
  }
}

function loadProductKey() {
  for (const envName of ["SWFIPN_API_PRODUCT_KEY", "SWFI2_PRODUCT_API_KEY", "SWFIPN_BACKEND_TOKEN", "SWFI2_API_TOKEN"]) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  return keychainLookup(envList("SWFIPN_API_PRODUCT_KEY_SERVICES", ["swfipn-api-product-key", "SWFI2_PRODUCT_API_KEYS", "swfi2-product-api-key", "SWFI2_API_TOKEN", "swfi2-api-token"])).trim();
}

function keychainLookup(services) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_AUTH_USE_KEYCHAIN || "1"))) return "";
  const accounts = envList("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"]);
  for (const account of accounts) {
    for (const service of services) {
      try {
        const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        if (value) return value;
      } catch {
        // Try next account/service pair.
      }
    }
  }
  return "";
}

function envList(name, fallback) {
  const raw = String(process.env[name] || "");
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeApiOrigin(value) {
  return new URL(value).origin;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
