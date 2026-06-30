#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const host = process.env.SWFIPN_RUNTIME_REMOTE_HOST || process.env.SWFIPN_HOST || "swfipn-do";
const container = process.env.SWFIPN_RECORD_PARITY_CONTAINER || "swfipn_acceptance-swfi2-backend-1";
const remoteScript = process.env.SWFIPN_RECORD_PARITY_REMOTE_SCRIPT || "/app/scripts/swfipn_record_level_parity_gate.py";
const remoteReceipt = process.env.SWFIPN_RECORD_PARITY_REMOTE_RECEIPT || "/app/product-state/swfipn-record-level-parity-gate-latest.json";
const passEnvNames = [
  "SWFIPN_ORIGIN",
  "SWFIPN_BACKEND_ORIGIN",
  "SWFIPN_RECORD_PARITY_SAMPLE",
  "SWFIPN_RECORD_PARITY_COLLECTIONS",
  "SWFIPN_RECORD_PARITY_RETRIES",
  "SWFIPN_RECORD_PARITY_TIMEOUT_SECONDS",
];
const outDir = path.resolve("output");
const localReceipt = path.join(outDir, "swfipn-record-level-parity-gate-latest.json");
const sshArgs = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=no",
  host,
];

function runSsh(command, options = {}) {
  return spawnSync("ssh", [...sshArgs, command], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout || 180_000,
  });
}

function fail(message, detail = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.remote_record_level_parity_gate.v1",
    status: "fail",
    generated_at: new Date().toISOString(),
    host,
    container,
    remote_script: remoteScript,
    remote_receipt: remoteReceipt,
    values_redacted: true,
    error: message,
    detail,
  };
  fs.writeFileSync(localReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: "fail", receipt: localReceipt, error: message }, null, 2));
  process.exit(1);
}

const escapedScript = remoteScript.replace(/'/g, "'\\''");
const escapedReceipt = remoteReceipt.replace(/'/g, "'\\''");
const escapedContainer = container.replace(/'/g, "'\\''");
const envArgs = passEnvNames
  .filter((name) => process.env[name])
  .map((name) => `-e '${name.replace(/'/g, "'\\''")}=${String(process.env[name]).replace(/'/g, "'\\''")}'`)
  .join(" ");
const run = runSsh(`docker exec ${envArgs} '${escapedContainer}' python '${escapedScript}'`, { timeout: 240_000 });
if (run.stdout.trim()) process.stdout.write(run.stdout);
if (run.stderr.trim()) process.stderr.write(run.stderr);
if (run.status !== 0) {
  // Still try to retrieve the receipt; the gate writes fail receipts on normal blockers.
  const receipt = runSsh(`docker exec '${escapedContainer}' cat '${escapedReceipt}'`, { timeout: 30_000 });
  if (receipt.status === 0 && receipt.stdout.trim()) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(localReceipt, receipt.stdout.endsWith("\n") ? receipt.stdout : `${receipt.stdout}\n`);
  }
  process.exit(run.status || 1);
}

const receipt = runSsh(`docker exec '${escapedContainer}' cat '${escapedReceipt}'`, { timeout: 30_000 });
if (receipt.status !== 0 || !receipt.stdout.trim()) {
  fail("remote_receipt_unavailable", { stderr: receipt.stderr.slice(0, 1000), status: receipt.status });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(localReceipt, receipt.stdout.endsWith("\n") ? receipt.stdout : `${receipt.stdout}\n`);

let parsed;
try {
  parsed = JSON.parse(receipt.stdout);
} catch (error) {
  fail("remote_receipt_invalid_json", { error: error.message });
}

console.log(JSON.stringify({
  status: parsed.status || "unknown",
  receipt: localReceipt,
  host,
  container,
  collections: Object.fromEntries(Object.entries(parsed.collection_results || {}).map(([key, value]) => [
    key,
    {
      count: value.count,
      checked: Array.isArray(value.records) ? value.records.length : 0,
      source_records_found: value.source_records_found,
      blocked: value.blocked,
      field_failures: value.field_failures,
    },
  ])),
  failures: Array.isArray(parsed.failures) ? parsed.failures.slice(0, 20) : [],
}, null, 2));

if (parsed.status !== "pass") process.exit(1);
