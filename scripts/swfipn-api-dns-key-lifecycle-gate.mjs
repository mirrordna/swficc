#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-api-dns-key-lifecycle-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const productionOrigin = normalizeApiOrigin(process.env.SWFIPN_API_PRODUCTION_ORIGIN || "https://api.swfi.com");
const acceptanceOrigin = normalizeApiOrigin(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || "https://swfipn.activemirror.ai");
const productionHost = new URL(productionOrigin).hostname;
const expectedARecords = envList("SWFIPN_API_EXPECTED_A", ["161.35.56.218"]);
const expectedCnames = envList("SWFIPN_API_EXPECTED_CNAME", []);
const requiredEndpoints = [
  "/v1/entities",
  "/v1/people",
  "/v1/transactions",
  "/v1/compass",
  "/v1/reports",
  "/v1/entities/aggregates",
];
const apiKey = loadProductKey();

async function main() {
  const dnsCheck = await checkDns(productionHost);
  const apiVhost = checkApiVhostReadiness();
  const acceptance = await checkApiSurface("acceptance_control", acceptanceOrigin);
  const production = await checkApiSurface("production_api_host", productionOrigin);

  const controlFailures = acceptance.failures.map((failure) => `acceptance_control:${failure}`);
  const blockers = [];
  if (!apiKey) blockers.push("production_api_key_not_available_in_env_or_keychain");
  if (apiVhost.status !== "pass") blockers.push(...apiVhost.failures.map((failure) => `vhost:${failure}`));
  if (dnsCheck.status !== "pass") blockers.push(...dnsCheck.failures.map((failure) => `dns:${failure}`));
  if (production.status !== "pass") blockers.push(...production.failures.map((failure) => `production:${failure}`));

  const status = controlFailures.length ? "fail" : blockers.length ? "blocked" : "pass";
  const receipt = {
    schema_version: "swfipn.api_dns_key_lifecycle_gate.v1",
    generated_at: new Date().toISOString(),
    status,
    production_origin: productionOrigin,
    acceptance_origin: acceptanceOrigin,
    no_secret_values_written: true,
    summary: {
      failures: controlFailures,
      blockers,
      keychain_or_env_key_present: Boolean(apiKey),
      api_vhost_status: apiVhost.status,
      api_vhost_http_status: apiVhost.http_status,
      api_vhost_location: apiVhost.location,
      production_dns_status: dnsCheck.status,
      production_docs_status: production.docs.response_status,
      production_docs_server: production.docs.headers.server || null,
      production_unauthenticated_status: production.unauthenticated.response_status,
      production_keyed_entities_status: production.keyed_entities?.response_status || null,
      acceptance_docs_status: acceptance.docs.response_status,
      acceptance_unauthenticated_status: acceptance.unauthenticated.response_status,
      acceptance_keyed_entities_status: acceptance.keyed_entities?.response_status || null,
      expected_dns_a_records: expectedARecords,
      actual_dns_a_records: dnsCheck.a_records,
      actual_dns_cnames: dnsCheck.cnames,
      verdict:
        status === "pass"
          ? "api.swfi.com serves the SWFI API product surface and keyed checks pass"
          : status === "blocked"
            ? "acceptance API works, but production API DNS/key lifecycle is not fully cut over"
            : "acceptance API control failed; investigate app/runtime before DNS cutover",
    },
    checks: {
      dns: dnsCheck,
      api_vhost: apiVhost,
      acceptance_control: acceptance,
      production_api_host: production,
    },
  };

  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  if (status === "fail") process.exit(1);
}

function checkApiVhostReadiness() {
  const failures = [];
  const targetIp = expectedARecords[0] || "";
  if (!targetIp) {
    return {
      name: "api_vhost_readiness",
      status: "skipped",
      reason: "no_expected_a_record_configured",
      target_ip: "",
      host: productionHost,
      http_status: null,
      location: "",
      failures,
    };
  }
  const url = `http://${targetIp}/docs`;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("curl", ["-sS", "-I", "--max-time", "10", "-H", `Host: ${productionHost}`, url], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    stdout = error.stdout?.toString?.() || "";
    stderr = error.stderr?.toString?.() || error.message;
    failures.push(`curl_failed:${cleanFailure(stderr)}`);
  }
  const statusMatch = stdout.match(/^HTTP\/\S+\s+(\d+)/im);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const locationMatch = stdout.match(/^location:\s*(.+)$/im);
  const location = locationMatch ? locationMatch[1].trim() : "";
  if (httpStatus !== 308 && httpStatus !== 301 && httpStatus !== 302) failures.push(`expected_https_redirect_got_${httpStatus || "missing"}`);
  if (location !== `${productionOrigin}/docs`) failures.push(`expected_location_${productionOrigin}/docs_got_${location || "missing"}`);
  return {
    name: "api_vhost_readiness",
    status: failures.length ? "blocked" : "pass",
    target_ip: targetIp,
    host: productionHost,
    url,
    http_status: httpStatus,
    location,
    stdout_preview: stdout.slice(0, 500),
    stderr_preview: stderr.slice(0, 500),
    failures,
  };
}

async function checkDns(hostname) {
  const failures = [];
  const aRecords = await resolveRecords(() => dns.resolve4(hostname));
  const cnames = await resolveRecords(() => dns.resolveCname(hostname));
  const hasExpectedA = expectedARecords.length === 0 || expectedARecords.some((expected) => aRecords.includes(expected));
  const hasExpectedCname = expectedCnames.length === 0 || expectedCnames.some((expected) => cnames.includes(expected));

  if (expectedARecords.length && !hasExpectedA) failures.push(`a_record_not_cut_over_expected_${expectedARecords.join("|")}_got_${aRecords.join("|") || "none"}`);
  if (expectedCnames.length && !hasExpectedCname) failures.push(`cname_not_cut_over_expected_${expectedCnames.join("|")}_got_${cnames.join("|") || "none"}`);

  return {
    name: "production_dns",
    host: hostname,
    status: failures.length ? "blocked" : "pass",
    expected_a_records: expectedARecords,
    expected_cnames: expectedCnames,
    a_records: aRecords,
    cnames,
    failures,
  };
}

async function checkApiSurface(name, origin) {
  const docs = await fetchJson(origin, "/docs");
  const unauthenticated = await fetchJson(origin, "/v1/entities?limit=1&offset=0");
  const failures = [];
  const docsBody = docs.body && typeof docs.body === "object" ? docs.body : {};
  const endpointPaths = Array.isArray(docsBody.endpoints)
    ? docsBody.endpoints.map((endpoint) => endpoint.path).filter(Boolean)
    : [];

  if (docs.response_status !== 200) failures.push(`docs_http_${docs.response_status}`);
  if (docsBody.status !== "ok") failures.push(`docs_status_${docsBody.status || "missing"}`);
  if (docsBody.base_url !== "https://api.swfi.com") failures.push(`docs_base_url_${docsBody.base_url || "missing"}`);
  if (docsBody.authentication?.header !== "X-API-Key") failures.push("docs_missing_x_api_key_auth");
  for (const endpoint of requiredEndpoints) {
    if (!endpointPaths.includes(endpoint)) failures.push(`docs_missing_endpoint_${endpoint}`);
  }
  if (unauthenticated.response_status !== 401) failures.push(`unauth_expected_401_got_${unauthenticated.response_status}`);

  let keyedEntities = null;
  let keyedAggregates = null;
  if (apiKey) {
    keyedEntities = await fetchJson(origin, "/v1/entities?limit=1&offset=0&q=Norway", { "X-API-Key": apiKey });
    keyedAggregates = await fetchJson(
      origin,
      "/v1/entities/aggregates?entity_class=pensions&region=all&smoothing=linear&start_year=1971",
      { "X-API-Key": apiKey }
    );
    validateKeyedList("keyed_entities", keyedEntities, failures);
    validateAggregates("keyed_aggregates", keyedAggregates, failures);
  }

  return {
    name,
    origin,
    status: failures.length ? "fail" : "pass",
    docs: {
      url: docs.url,
      response_status: docs.response_status,
      headers: docs.headers,
      body_summary: summarizeDocs(docsBody),
      text_preview: docs.text_preview,
    },
    unauthenticated: {
      url: unauthenticated.url,
      response_status: unauthenticated.response_status,
      headers: unauthenticated.headers,
      body_summary: summarizeBody(unauthenticated.body),
    },
    keyed_entities: keyedEntities
      ? {
          url: keyedEntities.url,
          response_status: keyedEntities.response_status,
          headers: keyedEntities.headers,
          body_summary: summarizeList(keyedEntities.body),
        }
      : null,
    keyed_aggregates: keyedAggregates
      ? {
          url: keyedAggregates.url,
          response_status: keyedAggregates.response_status,
          headers: keyedAggregates.headers,
          body_summary: summarizeAggregates(keyedAggregates.body),
        }
      : null,
    failures,
  };
}

function validateKeyedList(label, response, failures) {
  const body = response.body && typeof response.body === "object" ? response.body : {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (response.response_status !== 200) failures.push(`${label}_http_${response.response_status}`);
  if (body.status !== "ok") failures.push(`${label}_status_${body.status || "missing"}`);
  if (!items.length) failures.push(`${label}_missing_items`);
  if (typeof body.pagination?.total !== "number") failures.push(`${label}_missing_total`);
  if (body.freshness?.source !== "swfi_approved_data") failures.push(`${label}_freshness_${body.freshness?.source || "missing"}`);
}

function validateAggregates(label, response, failures) {
  const body = response.body && typeof response.body === "object" ? response.body : {};
  if (response.response_status !== 200) failures.push(`${label}_http_${response.response_status}`);
  if (body.status !== "ok") failures.push(`${label}_status_${body.status || "missing"}`);
  if (!Array.isArray(body.points) || body.points.length === 0) failures.push(`${label}_missing_points`);
  if (!Array.isArray(body.raw_points) || body.raw_points.length === 0) failures.push(`${label}_missing_raw_points`);
  if (body.freshness?.source !== "swfi_approved_data") failures.push(`${label}_freshness_${body.freshness?.source || "missing"}`);
}

async function fetchJson(origin, pathname, headers = {}) {
  const url = new URL(pathname, `${origin}/`).href;
  const response = await fetchWithTimeout(url, {
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
    response_status: response.status,
    headers: pickHeaders(response.headers),
    body,
    text_preview: text.slice(0, 300),
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SWFIPN_API_DNS_GATE_TIMEOUT_MS || 15000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRecords(resolveFn) {
  try {
    return await resolveFn();
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ENODOMAIN"].includes(error.code)) return [];
    return [`error:${error.code || error.message}`];
  }
}

function summarizeDocs(body) {
  const endpoints = Array.isArray(body.endpoints) ? body.endpoints.map((endpoint) => endpoint.path).filter(Boolean) : [];
  return {
    status: body.status || null,
    base_url: body.base_url || null,
    version: body.version || null,
    authentication_header: body.authentication?.header || null,
    endpoint_count: endpoints.length,
    endpoint_paths: endpoints,
  };
}

function summarizeList(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    status: body.status || null,
    collection: body.collection || null,
    item_count: items.length,
    pagination: body.pagination || null,
    freshness: body.freshness || null,
    first_item_keys: items[0] && typeof items[0] === "object" ? Object.keys(items[0]) : [],
  };
}

function summarizeAggregates(body) {
  return {
    status: body.status || null,
    collection: body.collection || null,
    point_count: Array.isArray(body.points) ? body.points.length : 0,
    raw_point_count: Array.isArray(body.raw_points) ? body.raw_points.length : 0,
    freshness: body.freshness || null,
    parameters: body.parameters || null,
  };
}

function summarizeBody(body) {
  if (!body || typeof body !== "object") return { type: typeof body };
  return {
    status: body.status || null,
    keys: Object.keys(body).slice(0, 20),
  };
}

function pickHeaders(headers) {
  const picked = {};
  for (const name of ["content-type", "server", "location", "cf-ray", "x-release-id"]) {
    const value = headers.get(name);
    if (value) picked[name.replaceAll("-", "_")] = value;
  }
  return picked;
}

function loadProductKey() {
  for (const envName of ["SWFIPN_API_PRODUCT_KEY", "SWFI2_PRODUCT_API_KEY", "SWFIPN_BACKEND_TOKEN", "SWFI2_API_TOKEN"]) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  return keychainLookup(
    envList("SWFIPN_API_PRODUCT_KEY_SERVICES", [
      "swfipn-api-product-key",
      "SWFI2_PRODUCT_API_KEYS",
      "swfi2-product-api-key",
      "SWFI2_API_TOKEN",
      "swfi2-api-token",
    ])
  ).trim();
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
        // Try next Keychain service/account pair.
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

function normalizeApiOrigin(value) {
  return new URL(value).origin;
}

function cleanFailure(value) {
  return String(value || "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.:-]/g, "")
    .slice(0, 120) || "unknown";
}

main().catch((error) => {
  const receipt = {
    schema_version: "swfipn.api_dns_key_lifecycle_gate.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    error: error.message,
    no_secret_values_written: true,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.error(error);
  process.exit(1);
});
