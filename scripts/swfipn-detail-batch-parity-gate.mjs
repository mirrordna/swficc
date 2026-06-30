#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-detail-batch-parity-latest.json");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const batchSize = clampInt(process.env.SWFIPN_DETAIL_BATCH_SIZE || "1000", 1, 1000);
const concurrency = clampInt(process.env.SWFIPN_DETAIL_CONCURRENCY || "6", 1, 16);
const collectionsToRun = new Set(String(process.env.SWFIPN_DETAIL_COLLECTIONS || "").split(",").map((v) => v.trim()).filter(Boolean));
const maxRowsPerCollection = clampInt(process.env.SWFIPN_DETAIL_MAX_ROWS || "0", 0, Number.MAX_SAFE_INTEGER);
const serviceToken = text(process.env.SWFIPN_BACKEND_TOKEN || process.env.SWFI2_API_TOKEN);

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function text(value) {
  return String(value ?? "").trim();
}

function latestMappingReceipt() {
  return JSON.parse(fs.readFileSync(path.join(outputDir, "swfipn-full-universe-mapping-latest.json"), "utf8"));
}

function manifestRecord(row) {
  return {
    id: text(row.id),
    label: text(row.label),
    source_url: text(row.source_url),
    legacy_post: text(row.legacy_post || row.legacy_post_id),
    report_key: text(row.report_key || row.report_id),
  };
}

async function postBatch(collection, records, retries = 6) {
  const url = `${backendOrigin}/api/source-data/detail-batch-verify/v1`;
  let lastError = "";
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-SWFIPN-Internal": "1",
    "User-Agent": "SWFIPN-DetailBatchParityGate/1.0",
  };
  if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify({ collection, records }),
      });
      const bodyText = await response.text();
      let body;
      try {
        body = JSON.parse(bodyText || "{}");
      } catch {
        body = { raw: bodyText.slice(0, 500) };
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await sleep(2500 * attempt);
        continue;
      }
      return { status: response.status, body };
    } catch (error) {
      lastError = error.message;
      if (attempt < retries) {
        await sleep(2500 * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, body: { status: "fetch_failed", error: lastError || "fetch_failed" } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyFamily(family) {
  const filePath = text(family.output);
  const result = {
    family: text(family.id),
    collection: text(family.collection || family.id),
    input: filePath,
    expected_rows: Number(family.rows_seen || family.source_total || 0),
    checked: 0,
    passed: 0,
    failed: 0,
    batches: 0,
    failures: [],
    samples: [],
  };
  if (!filePath || !fs.existsSync(filePath)) {
    result.failed = result.expected_rows || 1;
    result.failures.push({ reason: "missing_family_ndjson", input: filePath });
    return result;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch = [];
  let lineNumber = 0;
  const inFlight = new Set();
  let stopScheduling = false;

  async function drainOne() {
    if (!inFlight.size) return;
    await Promise.race(inFlight);
  }

  async function drainAll() {
    while (inFlight.size) await drainOne();
  }

  async function handlePacket(packet, packetBatch, batchNumber) {
    const data = packet.body?.data || {};
    if (packet.status !== 200 || packet.body?.status !== "ok") {
      result.failed += packetBatch.length;
      result.failures.push({
        batch: batchNumber,
        reason: `batch_http_${packet.status}_${packet.body?.status || "missing"}`,
        error: packet.body?.source_gap_reason || packet.body?.error || "",
      });
      return;
    }
    result.checked += Number(data.checked || 0);
    result.passed += Number(data.passed || 0);
    result.failed += Number(data.failed || 0);
    for (const row of data.rows || []) {
      if (row.ok !== true && result.failures.length < 1000) {
        result.failures.push({
          batch: batchNumber,
          id: row.id,
          expected_label: row.expected_label,
          detail_label: row.detail_label,
          failures: row.failures || [],
        });
      }
      if (result.samples.length < 5) {
        result.samples.push({
          id: row.id,
          ok: row.ok,
          expected_label: row.expected_label,
          detail_label: row.detail_label,
          detail_endpoint: row.detail_endpoint,
        });
      }
    }
    if (result.batches % 25 === 0 || batchNumber % 25 === 0) {
      console.error(`[detail-batch] ${result.family}: checked=${result.checked} failed=${result.failed} batches=${result.batches}`);
    }
  }

  async function flush() {
    if (!batch.length) return;
    result.batches += 1;
    const batchNumber = result.batches;
    const packetBatch = batch;
    batch = [];
    const task = postBatch(result.family, packetBatch)
      .then((packet) => handlePacket(packet, packetBatch, batchNumber))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
    if (inFlight.size >= concurrency) await drainOne();
  }

  for await (const line of rl) {
    if (maxRowsPerCollection && result.batches * batchSize + batch.length >= maxRowsPerCollection) {
      stopScheduling = true;
      break;
    }
    lineNumber += 1;
    const clean = line.trim();
    if (!clean) continue;
    let row;
    try {
      row = JSON.parse(clean);
    } catch (error) {
      result.failed += 1;
      result.failures.push({ line: lineNumber, reason: `source_ndjson_parse_error:${error.message}` });
      continue;
    }
    batch.push(manifestRecord(row));
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  await drainAll();
  if (stopScheduling) stream.destroy();
  return result;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const mapping = latestMappingReceipt();
  if (mapping.status !== "pass") throw new Error(`mapping_receipt_not_pass:${mapping.status || "missing"}`);
  const families = (mapping.families || []).filter((family) => !collectionsToRun.size || collectionsToRun.has(family.id));
  const results = [];
  for (const family of families) {
    console.error(`[detail-batch] ${family.id}: start`);
    const result = await verifyFamily(family);
    console.error(`[detail-batch] ${family.id}: checked=${result.checked} passed=${result.passed} failed=${result.failed}`);
    results.push(result);
  }
  const totals = results.reduce((acc, item) => {
    acc.expected_rows += item.expected_rows;
    acc.checked += item.checked;
    acc.passed += item.passed;
    acc.failed += item.failed;
    acc.batches += item.batches;
    return acc;
  }, { expected_rows: 0, checked: 0, passed: 0, failed: 0, batches: 0 });
  const receipt = {
    schema_version: "swfipn.detail_batch_parity.v1",
    generated_at: new Date().toISOString(),
    status: maxRowsPerCollection
      ? (totals.failed === 0 && totals.checked > 0 ? "partial" : "fail")
      : (totals.failed === 0 && totals.checked === totals.expected_rows && totals.expected_rows > 0 ? "pass" : "fail"),
    backend_origin: backendOrigin,
    mapping_run_id: mapping.run_id || "",
    mapping_receipt: "output/swfipn-full-universe-mapping-latest.json",
    verification_mode: "frozen_manifest_to_backend_detail_batch",
    scope: maxRowsPerCollection ? "partial_canary" : "full_frozen_manifest",
    max_rows_per_collection: maxRowsPerCollection || null,
    concurrency,
    auth: serviceToken ? "bearer_token_supplied" : "missing_bearer_token",
    batch_size: batchSize,
    totals,
    collections: Object.fromEntries(results.map((item) => [item.family, {
      expected_rows: item.expected_rows,
      checked: item.checked,
      passed: item.passed,
      failed: item.failed,
      batches: item.batches,
    }])),
    failures: results.flatMap((item) => item.failures.map((failure) => ({ collection: item.family, ...failure }))).slice(0, 1000),
    samples: Object.fromEntries(results.map((item) => [item.family, item.samples])),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, totals, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.detail_batch_parity.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    error: error.stack || error.message,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
