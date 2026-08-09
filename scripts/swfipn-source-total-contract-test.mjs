#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateSourceBoundTotal } from "./lib/source-total-contract.mjs";

const now = Date.parse("2026-08-09T12:00:00Z");
const packet = {
  status: "ok",
  fact: true,
  generated_at: "2026-08-09T11:55:00Z",
  data: {
    count: 23,
    source_collection: "swfi_api.compass.opportunities",
    coverage: { complete: true },
  },
};
const checks = [];

function check(id, run) {
  try {
    run();
    checks.push({ id, ok: true, failure: null });
  } catch (error) {
    checks.push({ id, ok: false, failure: String(error?.message || error) });
  }
}

check("accepts_exact_fresh_complete_source_total", () => {
  assert.deepEqual(
    validateSourceBoundTotal({
      packet,
      renderedTotal: 23,
      expectedSourceCollection: "swfi_api.compass.opportunities",
      now,
    }).failures,
    [],
  );
});
check("rejects_ui_source_count_mismatch", () => {
  assert.match(validateSourceBoundTotal({ packet, renderedTotal: 22, now }).failures.join("|"), /rendered_total_22_ne_source_23/);
});
check("rejects_non_fact_packet", () => {
  assert.match(validateSourceBoundTotal({ packet: { ...packet, fact: false }, renderedTotal: 23, now }).failures.join("|"), /source_packet_not_fact/);
});
check("rejects_missing_source_count", () => {
  assert.match(validateSourceBoundTotal({ packet: { ...packet, data: { ...packet.data, count: null } }, renderedTotal: 23, now }).failures.join("|"), /source_packet_count_missing/);
});
check("rejects_incomplete_coverage", () => {
  assert.match(validateSourceBoundTotal({ packet: { ...packet, data: { ...packet.data, coverage: { complete: false } } }, renderedTotal: 23, now }).failures.join("|"), /source_packet_coverage_incomplete/);
});
check("rejects_missing_coverage", () => {
  assert.match(validateSourceBoundTotal({ packet: { ...packet, data: { ...packet.data, coverage: undefined } }, renderedTotal: 23, now }).failures.join("|"), /source_packet_coverage_missing/);
});
check("rejects_stale_packet", () => {
  assert.match(validateSourceBoundTotal({ packet: { ...packet, generated_at: "2026-08-07T00:00:00Z" }, renderedTotal: 23, now }).failures.join("|"), /source_packet_stale_or_invalid/);
});
check("rejects_wrong_source_collection", () => {
  assert.match(
    validateSourceBoundTotal({ packet: { ...packet, data: { ...packet.data, source_collection: "wrong" } }, renderedTotal: 23, expectedSourceCollection: "swfi_api.compass.opportunities", now }).failures.join("|"),
    /source_collection_wrong_ne_swfi_api\.compass\.opportunities/,
  );
});

const generatedAt = new Date().toISOString();
const failures = checks.filter((item) => !item.ok);
const receipt = {
  schema_version: "swfipn.source_total_contract_test.v1",
  generated_at: generatedAt,
  status: failures.length ? "fail" : "pass",
  summary: { checks: checks.length, failures: failures.length },
  checks,
  failures,
};
const outputDir = path.join(process.cwd(), "output");
const runDir = path.join(outputDir, "source-total-contract-runs");
const runName = `${generatedAt.replaceAll(":", "-")}.json`;
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "swfipn-source-total-contract-latest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
fs.writeFileSync(path.join(runDir, runName), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, ...receipt.summary, receipt: path.join(outputDir, "swfipn-source-total-contract-latest.json"), immutable_receipt: path.join(runDir, runName) }, null, 2));
if (failures.length) process.exit(1);
