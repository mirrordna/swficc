#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "output");
const sampleReceipt = path.join(output, "swfipn-canonical-search-browser-gate-latest.json");
const receiptPath = path.join(output, "swfipn-canonical-search-stability-gate-latest.json");
const runs = Math.max(2, Math.min(5, Number.parseInt(process.env.SWFIPN_SEARCH_STABILITY_RUNS || "2", 10) || 2));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function runSample(index) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "swfipn-canonical-search-browser-gate.mjs")], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  let receipt = null;
  let raw = "";
  try {
    raw = fs.readFileSync(sampleReceipt, "utf8");
    receipt = JSON.parse(raw);
  } catch {
    // Missing or malformed sample evidence is an explicit failed sample.
  }
  const archivedPath = path.join(output, `swfipn-canonical-search-browser-gate-sample-${index}.json`);
  if (raw) fs.writeFileSync(archivedPath, raw);
  return {
    id: `cold_start_${index}`,
    status: result.status === 0 && receipt?.status === "pass" ? "pass" : "fail",
    process_exit_code: result.status,
    process_signal: result.signal || null,
    process_error: result.error?.message || null,
    process_stdout: String(result.stdout || "").slice(-4_000),
    process_stderr: String(result.stderr || "").slice(-4_000),
    generated_at: receipt?.generated_at || null,
    receipt_path: raw ? path.relative(root, archivedPath) : null,
    receipt_sha256: raw ? sha256(raw) : null,
    target_mode: receipt?.target_mode || null,
    source_backend_origin: receipt?.source_backend_origin || null,
    candidate_identity: receipt?.candidate_identity || null,
    tested_release_git_sha: receipt?.tested_release_git_sha || null,
    tested_release_asset_version: receipt?.tested_release_asset_version || null,
    failed_checks: Array.isArray(receipt?.checks)
      ? receipt.checks.filter((check) => check.pass !== true).map((check) => check.id)
      : ["sample_receipt_missing_or_invalid"],
    timings: Array.isArray(receipt?.checks)
      ? receipt.checks.filter((check) => check.id === "adia" || check.id === "hkic").map((check) => ({
          id: check.id,
          entity_ms: check.entity_ms,
          live_entity_ms: check.live_entity_ms,
          news_ms: check.news_ms,
          pass: check.pass,
        }))
      : [],
    network_trace: Array.isArray(receipt?.checks)
      ? receipt.checks.filter((check) => check.id === "adia" || check.id === "hkic").map((check) => ({
          id: check.id,
          events: check.network_trace || [],
      }))
      : [],
    deterministic_results: Array.isArray(receipt?.checks)
      ? receipt.checks.filter((check) => check.id === "adia" || check.id === "hkic").map((check) => ({
          id: check.id,
          fingerprint_sha256: check.deterministic_result_fingerprint_sha256 || null,
          counts: check.deterministic_result_counts || null,
          categories: check.deterministic_result_set || null,
          complete: check.deterministic_result_set_complete === true,
          sources_complete: check.deterministic_result_sources_complete === true,
        }))
      : [],
  };
}

function main() {
  fs.mkdirSync(output, { recursive: true });
  const samples = [];
  for (let index = 1; index <= runs; index += 1) samples.push(runSample(index));
  const first = samples[0] || {};
  const identityConsistent = samples.every((sample) => (
    sample.target_mode === first.target_mode
    && sample.source_backend_origin === first.source_backend_origin
    && sameJson(sample.candidate_identity, first.candidate_identity)
    && sample.tested_release_git_sha === first.tested_release_git_sha
    && sample.tested_release_asset_version === first.tested_release_asset_version
  ));
  const deterministicResultsComplete = samples.every((sample) => (
    sample.deterministic_results.length === 2
    && sample.deterministic_results.every((result) => (
      /^[a-f0-9]{64}$/i.test(result.fingerprint_sha256 || "")
      && result.complete
      && result.sources_complete
    ))
  ));
  const deterministicResultsConsistent = deterministicResultsComplete
    && samples.every((sample) => sameJson(sample.deterministic_results, first.deterministic_results));
  const failures = [
    ...samples.filter((sample) => sample.status !== "pass").map((sample) => `${sample.id}:failed`),
    ...(!identityConsistent ? ["sample_identity_drift"] : []),
    ...(!deterministicResultsComplete ? ["deterministic_result_set_incomplete"] : []),
    ...(!deterministicResultsConsistent ? ["deterministic_result_drift"] : []),
  ];
  const receipt = {
    schema_version: "swfipn.canonical_search_stability_gate.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    evidence_class: first.target_mode === "live"
      ? "LIVE_TARGET_REPEATED_SURFACE_BEHAVIOR_NOT_GLOBAL_ACCEPTANCE"
      : "CANDIDATE_REPEATED_WITH_LIVE_SWFI_SOURCES_NOT_PRODUCTION_ACCEPTANCE",
    target_mode: first.target_mode || null,
    source_backend_origin: first.source_backend_origin || null,
    candidate_identity: first.candidate_identity || null,
    tested_release_git_sha: first.tested_release_git_sha || null,
    tested_release_asset_version: first.tested_release_asset_version || null,
    release_identity_pinned: samples.every((sample) => sample.target_mode !== "live"
      || (/^[a-f0-9]{40}$/i.test(sample.tested_release_git_sha || "") && Boolean(sample.tested_release_asset_version))),
    required_cold_start_samples: runs,
    passed_cold_start_samples: samples.filter((sample) => sample.status === "pass").length,
    identity_consistent: identityConsistent,
    deterministic_results_complete: deterministicResultsComplete,
    deterministic_results_consistent: deterministicResultsConsistent,
    baseline_result_fingerprints: Object.fromEntries(
      (first.deterministic_results || []).map((result) => [result.id, result.fingerprint_sha256]),
    ),
    samples,
    bad_news: failures,
    checked_scope: [
      "repeated_cold_start_ADIA_search",
      "repeated_cold_start_HKIC_search",
      "sample_identity_consistency",
      "ordered_category_result_identity_consistency",
      "core_category_completeness",
      "canonical_source_identity_presence",
    ],
    unchecked_scope: first.target_mode === "live"
      ? ["stakeholder_acceptance", "Mongo_record_parity", "global_release_acceptance"]
      : ["deployed_production", "stakeholder_acceptance", "Mongo_record_parity"],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    receipt: receiptPath,
    required_samples: runs,
    passed_samples: receipt.passed_cold_start_samples,
    failures,
    samples: samples.map((sample) => ({ id: sample.id, status: sample.status, timings: sample.timings })),
  }, null, 2));
  if (receipt.status !== "pass") process.exitCode = 1;
}

main();
