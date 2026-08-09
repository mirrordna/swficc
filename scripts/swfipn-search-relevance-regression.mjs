#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-search-relevance-regression-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const {
  businessSearchQueryVariants,
  rankSearchRecordsAcrossQueryVariants,
  rankSearchRecords,
  searchSubjectQuery,
  verifiedCanonicalSearchName,
} = await import(pathToFileURL(path.join(cwd, "src/lib/searchRelevance.ts")).href);

const fixtures = {
  abuDhabi: [
    entity("Abu Dhabi Accountability Authority", "Government", 0),
    entity("Abu Dhabi Developmental Holding Company", "Sovereign Wealth Fund", 263_395_613_250, "ADQ"),
    entity("Abu Dhabi Investment Authority", "Sovereign Wealth Fund", 1_128_750_000_000, "ADIA"),
    entity("Abu Dhabi Investment Council", "Sovereign Wealth Fund", 0),
    entity("Abu Dhabi Pension Fund", "Public Pension", 34_000_000_000),
    entity("Abu Dhabi Commercial Bank", "Bank", 220_195_141_110),
    entity("Abu Dhabi Aircraft Technologies", "Company", 0),
  ],
  pif: [
    entity("Ampifii", "Company", 0),
    entity("Bpifrance", "Development Bank", 125_074_219_156),
    entity("Public Investment Fund", "Sovereign Wealth Fund", 900_000_000_000, "PIF"),
    entity("PIFA FC", "Company", 0),
  ],
  zurich: [
    entity("Zurich Insurance Group", "Insurance", 358_005_000_000),
    entity("Zurich Re", "Insurance", 0),
  ],
};

const checks = [
  {
    id: "client_abu_dhabi_business_order",
    query: "Abu Dhabi",
    actual: rankSearchRecords(fixtures.abuDhabi, "Abu Dhabi", "entity").slice(0, 3).map((row) => row.name),
    expected: ["Abu Dhabi Investment Authority", "Abu Dhabi Developmental Holding Company", "Abu Dhabi Pension Fund"],
  },
  {
    id: "client_pif_synonym",
    query: "PIF",
    actual: rankSearchRecords(fixtures.pif, "PIF", "entity").slice(0, 1).map((row) => row.name),
    expected: ["Public Investment Fund"],
  },
  {
    id: "client_zurich_exact",
    query: "Zurich Insurance Group",
    actual: rankSearchRecords(fixtures.zurich, "Zurich Insurance Group", "entity").slice(0, 1).map((row) => row.name),
    expected: ["Zurich Insurance Group"],
  },
  {
    id: "query_variant_pif",
    query: "PIF",
    actual: businessSearchQueryVariants("PIF"),
    expected: ["PIF", "Public Investment Fund"],
  },
  {
    id: "query_variant_adia_full_name_includes_acronym",
    query: "Abu Dhabi Investment Authority",
    actual: businessSearchQueryVariants("Abu Dhabi Investment Authority"),
    expected: ["Abu Dhabi Investment Authority", "ADIA"],
  },
  {
    id: "query_variant_hkic",
    query: "HKIC",
    actual: businessSearchQueryVariants("HKIC"),
    expected: ["HKIC", "Hong Kong Investment Corporation"],
  },
  {
    id: "query_variant_hkic_full_name_includes_acronym",
    query: "Hong Kong Investment Corporation",
    actual: businessSearchQueryVariants("Hong Kong Investment Corporation"),
    expected: ["Hong Kong Investment Corporation", "HKIC"],
  },
  {
    id: "hkic_full_name_keeps_acronym_news",
    query: "Hong Kong Investment Corporation",
    actual: rankSearchRecordsAcrossQueryVariants([
      { id: "news-1", title: "HKIC expands its institutional investment program" },
    ], "Hong Kong Investment Corporation", "news").map((row) => row.title),
    expected: ["HKIC expands its institutional investment program"],
  },
  {
    id: "verified_alias_beats_exact_name_collision",
    query: "ADIA",
    actual: verifiedCanonicalSearchName("ADIA", [
      entity("Adia", "Company", 0),
      entity("Abu Dhabi Investment Authority", "Sovereign Wealth Fund", 1_128_750_000_000),
    ]),
    expected: "Abu Dhabi Investment Authority",
  },
  {
    id: "query_variant_sovereign_wealth_funds",
    query: "sovereign wealth funds",
    actual: businessSearchQueryVariants("sovereign wealth funds"),
    expected: ["sovereign wealth funds", "Sovereign Wealth Fund"],
  },
  {
    id: "query_variant_pension_funds",
    query: "pension funds",
    actual: businessSearchQueryVariants("pension funds"),
    expected: ["pension funds", "Public Pension"],
  },
  {
    id: "query_variant_family_offices",
    query: "family offices",
    actual: businessSearchQueryVariants("family offices"),
    expected: ["family offices", "Family Office"],
  },
  {
    id: "natural_language_entity_subject_give",
    query: "Give me information about ADIA",
    actual: [searchSubjectQuery("Give me information about ADIA"), ...businessSearchQueryVariants("Give me information about ADIA").slice(1)],
    expected: ["ADIA", "Abu Dhabi Investment Authority"],
  },
  {
    id: "natural_language_entity_subject_provide",
    query: "Provide me with information about PIF",
    actual: rankSearchRecords(fixtures.pif, "Provide me with information about PIF", "entity").slice(0, 1).map((row) => row.name),
    expected: ["Public Investment Fund"],
  },
  {
    id: "natural_language_entity_subject_retrieve",
    query: "Retrieve information about Zurich Insurance Group",
    actual: rankSearchRecords(fixtures.zurich, "Retrieve information about Zurich Insurance Group", "entity").slice(0, 1).map((row) => row.name),
    expected: ["Zurich Insurance Group"],
  },
];

const serverChecks = await runServerRenderedChecks();
checks.push(...serverChecks);

const failures = checks
  .filter((check) => JSON.stringify(check.actual) !== JSON.stringify(check.expected))
  .map((check) => ({
    id: check.id,
    query: check.query,
    expected: check.expected,
    actual: check.actual,
  }));

const receipt = {
  schema_version: "swfipn.search_relevance_regression.v2",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  checks,
  failures,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, failures }, null, 2));
if (failures.length) process.exit(1);

async function runServerRenderedChecks() {
  const backendPort = await freePort();
  const searchPort = await freePort();
  const backend = await startFakeBackend(backendPort);
  const searchServer = childProcess.spawn("python3", [
    path.join(cwd, "scripts/serve-static-with-headers.py"),
    "--host",
    "127.0.0.1",
    "--port",
    String(searchPort),
    "--root",
    outputDir,
    "--backend",
    `http://127.0.0.1:${backendPort}`,
    "--backend-timeout",
    "5",
  ], {
    cwd,
    env: { ...process.env, SWFIPN_BACKEND_TOKEN_USE_KEYCHAIN: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  searchServer.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHttp(`http://127.0.0.1:${searchPort}/api/v1/public/search?q=health&limit=25`, 5_000);
    const pifApi = await fetchJson(`http://127.0.0.1:${searchPort}/api/v1/public/search?q=PIF&limit=25`);
    return [
      {
        id: "edge_public_api_pif_synonym_before_substring_noise",
        query: "PIF",
        actual: [pifApi?.data?.results?.[0]?.name || ""],
        expected: ["Public Investment Fund"],
      },
    ];
  } catch (error) {
    return [{
      id: "server_rendered_search_runtime",
      query: "server",
      actual: [String(error?.message || error), stderr.slice(0, 500)],
      expected: ["pass", ""],
    }];
  } finally {
    searchServer.kill("SIGTERM");
    backend.close();
  }
}

function startFakeBackend(port) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    let packet = factPacket({ results: [] });
    if (url.pathname === "/api/v1/public/search") {
      packet = factPacket({ results: publicRows(url.searchParams.get("q") || "") });
    } else if (url.pathname === "/api/source-data/search/v1") {
      packet = factPacket({ rows: sourceRows(url.searchParams.get("q") || "") });
    }
    const body = JSON.stringify(packet);
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function publicRows(query) {
  const clean = query.trim().toLowerCase();
  if (clean === "pif") return [fixtures.pif[0], fixtures.pif[1]];
  if (clean === "public investment fund") return [fixtures.pif[2], fixtures.pif[1], fixtures.pif[0]];
  if (clean === "zurich insurance group") return fixtures.zurich;
  if (clean === "abu dhabi") return [fixtures.abuDhabi[1], fixtures.abuDhabi[2], fixtures.abuDhabi[3], fixtures.abuDhabi[4]];
  return [];
}

function sourceRows(query) {
  const clean = query.trim().toLowerCase();
  if (clean === "public investment fund") return [fixtures.pif[2], fixtures.pif[1], fixtures.pif[0]];
  if (clean === "pif") return [fixtures.pif[0], fixtures.pif[1]];
  if (clean === "zurich insurance group") return fixtures.zurich;
  if (clean === "abu dhabi") return [fixtures.abuDhabi[1], fixtures.abuDhabi[2], fixtures.abuDhabi[3], fixtures.abuDhabi[4]];
  return [];
}

function factPacket(data) {
  return {
    status: "ok",
    result_qualifier: "fact",
    fact: true,
    generated_at: new Date(0).toISOString(),
    data,
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await fetchText(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function entity(name, type, aum, alias = "") {
  return {
    name,
    legal_name: alias ? `${name} (${alias})` : name,
    type,
    country: "United Arab Emirates",
    aum,
    assets: aum,
    source_url: `https://www.swfi.com/v1/entities/${fakeObjectId(name)}`,
  };
}

function fakeObjectId(value) {
  return Buffer.from(value).toString("hex").padEnd(24, "0").slice(0, 24);
}
