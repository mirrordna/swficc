#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-route-parity-statistical-latest.json");
const markdownPath = path.join(outputDir, "swfipn-route-parity-statistical-latest.md");

const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399").replace(/\/swficc\/?$/, "").replace(/\/$/, "");
const serviceToken = String(process.env.SWFIPN_BACKEND_TOKEN || process.env.SWFI2_API_TOKEN || "").trim();
const CONFIDENCE = 0.99;
const Z = 2.576;
const MARGIN = 0.03;
const SAMPLE_TARGET = Math.ceil((Z * Z * 0.25) / (MARGIN * MARGIN));
const API_CONCURRENCY = 10;
const API_TIMEOUT_MS = 15_000;
const UNIVERSE_DIR = path.join(outputDir, "full-universe");

const COLLECTIONS = [
  { name: "entities", apiPath: (id) => `/api/profiles/${id}/v1`, nameFields: ["name", "institution", "legal_name"] },
  { name: "people", apiPath: (id) => `/api/people/${id}/v1`, nameFields: ["name", "title"] },
  { name: "transactions", apiPath: (id) => `/api/transactions/${id}/v1`, nameFields: ["title", "name"] },
  { name: "compass", apiPath: (id) => `/api/compass/${id}/v1`, nameFields: ["title", "name"] },
  { name: "news", apiPath: null, nameFields: ["title", "name"] },
  { name: "reports", apiPath: null, nameFields: ["title", "name"] },
];

async function fetchJson(url, timeoutMs = API_TIMEOUT_MS, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "SWFIPN-StatisticalGate/1.0",
          ...(serviceToken ? { Authorization: `Bearer ${serviceToken}`, "X-SWFIPN-Internal": "1" } : {}),
        },
      });
      if (response.status >= 500 && attempt < retries) {
        clearTimeout(timeout);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
      return { status: response.status, json };
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { status: 0, json: null, error: error.message };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function loadNdjsonRecords(collectionName) {
  const files = fs.readdirSync(UNIVERSE_DIR).filter((f) => f.includes(`-${collectionName}.ndjson`)).sort().reverse();
  if (!files.length) throw new Error(`No NDJSON file found for ${collectionName} in ${UNIVERSE_DIR}. Run npm run universe:map:public first.`);
  const filePath = path.join(UNIVERSE_DIR, files[0]);
  // 2026-07-10: the entities NDJSON exceeds V8's max string length, so one
  // readFileSync string crashes with ERR_STRING_TOO_LONG. Read in chunks and
  // split on newline bytes, decoding whole lines only (no mid-character splits).
  const records = [];
  const parseLine = (line) => {
    if (!line) return;
    try {
      const row = JSON.parse(line);
      const id = row.id || "";
      const name = row.label || "";
      const family = row.family || collectionName;
      if (id) records.push({ id, name: String(name).trim(), family });
    } catch { /* skip malformed lines */ }
  };
  const fd = fs.openSync(filePath, "r");
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let carry = Buffer.alloc(0);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : Buffer.from(chunk.subarray(0, bytesRead));
      let start = 0;
      let idx;
      while ((idx = buf.indexOf(0x0a, start)) !== -1) {
        parseLine(buf.toString("utf-8", start, idx));
        start = idx + 1;
      }
      carry = Buffer.from(buf.subarray(start));
    }
    if (carry.length) parseLine(carry.toString("utf-8"));
  } finally {
    fs.closeSync(fd);
  }
  return records;
}

function stratifiedSample(collectionRecords, totalTarget) {
  const totalRecords = Object.values(collectionRecords).reduce((s, r) => s + r.length, 0);
  const sampled = {};
  let totalSampled = 0;

  for (const [name, records] of Object.entries(collectionRecords)) {
    const proportion = records.length / totalRecords;
    let sampleSize = Math.max(1, Math.round(proportion * totalTarget));
    if (sampleSize > records.length) sampleSize = records.length;

    const shuffled = [...records];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    sampled[name] = shuffled.slice(0, sampleSize);
    totalSampled += sampled[name].length;
  }

  return { sampled, totalSampled, totalRecords };
}

async function verifyBatch(items, concurrency) {
  const results = [];
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((item) => item.verify()));
    results.push(...batchResults);
    i += concurrency;
  }
  return results;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const overallStart = Date.now();
  console.error(`[statistical] Target sample: ${SAMPLE_TARGET} records (${CONFIDENCE * 100}% confidence, ±${MARGIN * 100}% margin)`);
  console.error(`[statistical] Backend: ${backendOrigin}`);

  // Phase 1: Load records from full-universe NDJSON files
  console.error("[statistical] Phase 1: Loading from full-universe NDJSON");
  const collectionRecords = {};
  for (const col of COLLECTIONS) {
    collectionRecords[col.name] = loadNdjsonRecords(col.name);
    console.error(`[statistical]   ${col.name}: ${collectionRecords[col.name].length} records`);
  }

  // Phase 2: Stratified random sample
  console.error("[statistical] Phase 2: Stratified sampling");
  const { sampled, totalSampled, totalRecords } = stratifiedSample(collectionRecords, SAMPLE_TARGET);
  for (const [name, records] of Object.entries(sampled)) {
    console.error(`[statistical]   ${name}: ${records.length} sampled`);
  }
  console.error(`[statistical]   total sampled: ${totalSampled} from ${totalRecords} records`);

  // Phase 3: API verification
  console.error("[statistical] Phase 3: API verification");
  const findings = [];
  const collectionResults = {};

  for (const col of COLLECTIONS) {
    const records = sampled[col.name] || [];
    if (!records.length) continue;
    collectionResults[col.name] = { total: records.length, passed: 0, failed: 0, skipped: 0 };

    if (!col.apiPath) {
      collectionResults[col.name].skipped = records.length;
      for (const record of records) {
        findings.push({ collection: col.name, id: record.id, scan_name: record.name, status: "SKIP", reason: "no_detail_api" });
      }
      console.error(`[statistical]   ${col.name}: ${records.length} skipped (no detail API)`);
      continue;
    }

    const verifyItems = records.map((record) => ({
      verify: async () => {
        const apiUrl = `${backendOrigin}${col.apiPath(record.id)}`;
        const { status, json, error } = await fetchJson(apiUrl);
        const finding = {
          collection: col.name,
          id: record.id,
          scan_name: record.name,
          api_url: apiUrl,
          api_status: status,
          api_name: "",
          status: "PASS",
          reason: "",
          failures: [],
        };

        if (status === 0) {
          finding.status = "FAIL";
          finding.reason = `network_error:${error || "unknown"}`;
          finding.failures.push(finding.reason);
          return finding;
        }
        if (status >= 400) {
          finding.status = "FAIL";
          finding.reason = `api_http_${status}`;
          finding.failures.push(finding.reason);
          return finding;
        }

        const data = json?.data || {};
        const record_obj = data.profile || data.record || data.person || data.transaction || data.mandate || data;

        for (const field of col.nameFields) {
          const val = record_obj?.[field];
          if (val && typeof val === "string" && val.trim()) { finding.api_name = val.trim(); break; }
        }

        if (!finding.api_name) {
          finding.status = "FAIL";
          finding.reason = "api_no_name_field";
          finding.failures.push("api_no_name_field");
          return finding;
        }

        const returnedId = record_obj?._id || record_obj?.id || "";
        if (returnedId && returnedId !== record.id) {
          finding.status = "FAIL";
          finding.reason = `id_mismatch:requested=${record.id}|returned=${returnedId}`;
          finding.failures.push(finding.reason);
          return finding;
        }

        if (record.name && finding.api_name) {
          const scanSlice = record.name.toLowerCase().slice(0, 40);
          const apiSlice = finding.api_name.toLowerCase().slice(0, 40);
          if (scanSlice !== apiSlice && !apiSlice.includes(scanSlice) && !scanSlice.includes(apiSlice)) {
            finding.status = "FAIL";
            finding.reason = `name_mismatch:scan="${record.name.slice(0, 40)}"|api="${finding.api_name.slice(0, 40)}"`;
            finding.failures.push(finding.reason);
          }
        }

        return finding;
      },
    }));

    const results = await verifyBatch(verifyItems, API_CONCURRENCY);
    for (const r of results) {
      findings.push(r);
      if (r.status === "PASS") collectionResults[col.name].passed++;
      else collectionResults[col.name].failed++;
    }
    console.error(`[statistical]   ${col.name}: ${collectionResults[col.name].passed} pass, ${collectionResults[col.name].failed} fail`);
  }

  // Phase 4: Statistics
  const testable = findings.filter((f) => f.status !== "SKIP");
  const passed = testable.filter((f) => f.status === "PASS").length;
  const failed = testable.filter((f) => f.status === "FAIL").length;
  const skipped = findings.filter((f) => f.status === "SKIP").length;
  const pHat = testable.length > 0 ? passed / testable.length : 0;
  const se = testable.length > 0 ? Math.sqrt((pHat * (1 - pHat)) / testable.length) : 0;
  const ciLower = Math.max(0, pHat - Z * se);
  const ciUpper = Math.min(1, pHat + Z * se);
  const overallStatus = failed === 0 ? "pass" : "fail";

  const receipt = {
    schema_version: "swfipn.route_parity_statistical.v1",
    generated_at: new Date().toISOString(),
    backend_origin: backendOrigin,
    status: overallStatus,
    statistics: {
      confidence_level: CONFIDENCE,
      z_score: Z,
      margin_of_error: MARGIN,
      target_sample_size: SAMPLE_TARGET,
      universe_size: totalRecords,
      actual_sample_size: testable.length,
      skipped_no_api: skipped,
      passed,
      failed,
      pass_rate: pHat,
      standard_error: se,
      confidence_interval: { lower: ciLower, upper: ciUpper },
      confidence_interval_pct: `${(ciLower * 100).toFixed(2)}% – ${(ciUpper * 100).toFixed(2)}%`,
    },
    collection_results: collectionResults,
    failures: findings.filter((f) => f.status === "FAIL").slice(0, 100),
    overall_elapsed_ms: Date.now() - overallStart,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const md = [
    "# SWFIPN Route Parity — Statistical Confidence Gate",
    "",
    `**Generated**: ${receipt.generated_at}`,
    `**Status**: ${receipt.status.toUpperCase()}`,
    `**Backend**: ${backendOrigin}`,
    "",
    "## Statistical Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Universe size | ${totalRecords.toLocaleString()} |`,
    `| Sample size (testable) | ${testable.length.toLocaleString()} |`,
    `| Skipped (no detail API) | ${skipped.toLocaleString()} |`,
    `| Passed | ${passed.toLocaleString()} |`,
    `| Failed | ${failed.toLocaleString()} |`,
    `| Pass rate | ${(pHat * 100).toFixed(4)}% |`,
    `| Confidence level | ${(CONFIDENCE * 100).toFixed(0)}% |`,
    `| Confidence interval | ${receipt.statistics.confidence_interval_pct} |`,
    `| Elapsed | ${receipt.overall_elapsed_ms.toLocaleString()}ms |`,
    "",
    "## Collection Breakdown",
    "",
    "| Collection | Universe | Sampled | Passed | Failed | Skipped |",
    "|---|---|---|---|---|---|",
  ];
  for (const col of COLLECTIONS) {
    const cr = collectionResults[col.name] || {};
    const universe = collectionRecords[col.name]?.length || 0;
    md.push(`| ${col.name} | ${universe.toLocaleString()} | ${cr.total || 0} | ${cr.passed || 0} | ${cr.failed || 0} | ${cr.skipped || 0} |`);
  }
  md.push("");

  if (failed > 0) {
    md.push("## Failures (first 20)", "", "| # | Collection | ID | Reason |", "|---|---|---|---|");
    for (const [i, f] of receipt.failures.slice(0, 20).entries()) {
      md.push(`| ${i + 1} | ${f.collection} | ${f.id} | ${f.reason.slice(0, 60)} |`);
    }
    md.push("");
  }

  if (failed === 0) {
    md.push(`At 99% confidence, the true pass rate across all ${totalRecords.toLocaleString()} records is between ${receipt.statistics.confidence_interval_pct}.`, "");
  }

  fs.writeFileSync(markdownPath, md.join("\n") + "\n");

  console.log(JSON.stringify({
    status: receipt.status,
    statistics: receipt.statistics,
    collection_results: collectionResults,
    receipt: receiptPath,
    markdown: markdownPath,
  }, null, 2));

  process.exit(overallStatus === "pass" ? 0 : 1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ schema_version: "swfipn.route_parity_statistical.v1", status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
