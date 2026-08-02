#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "output");
const receiptPath = path.join(output, "swfipn-july31-release-gate-latest.json");
const maxAgeMs = 6 * 60 * 60 * 1000;

const receiptFiles = {
  search: "swfipn-canonical-search-stability-gate-latest.json",
  visualization: "swfipn-section-visualization-brd-gate-latest.json",
  numeric: "swfipn-numeric-truth-adversarial-latest.json",
  paritySample: "swfipn-record-level-parity-gate-latest.json",
  parityFull: "swfipn-record-field-parity-full-latest.json",
  stakeholder: "swfipn-july31-stakeholder-acceptance-latest.json",
};

function readJson(file) {
  try {
    const raw = fs.readFileSync(path.join(output, file), "utf8");
    return { ...JSON.parse(raw), _receipt_sha256: createHash("sha256").update(raw).digest("hex") };
  } catch {
    return null;
  }
}

function currentIdentity() {
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const gitDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
  const asset = readJson("swfipn-asset-version-latest.json");
  return { git_sha: gitSha, git_dirty: gitDirty, asset_version: asset?.status === "pass" ? asset.version || null : null };
}

function fresh(receipt, now) {
  const generated = Date.parse(String(receipt?.generated_at || ""));
  return Number.isFinite(generated) && now - generated >= 0 && now - generated <= maxAgeMs;
}

function normalizedSourceOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function evaluate({ mode, receipts, identity, expectedRelease, sourceOrigin, stakeholderApprovalSha, now = Date.now() }) {
  const checks = [];
  const add = (id, ok, detail = null) => checks.push({ id, status: ok ? "PASS" : "BLOCKED", detail });
  const { search, visualization, numeric, paritySample, parityFull, stakeholder } = receipts;
  const acceptanceIdentity = mode === "production" ? expectedRelease : identity;

  add("search_receipt_current_pass", search?.status === "pass" && fresh(search, now), search?.status || "missing");
  add("search_cold_start_stability", Number(search?.required_cold_start_samples) >= 2
    && search?.passed_cold_start_samples === search?.required_cold_start_samples
    && search?.identity_consistent === true,
  search ? {
    required: search.required_cold_start_samples,
    passed: search.passed_cold_start_samples,
    identity_consistent: search.identity_consistent,
  } : "missing");
  add("visualization_receipt_current_pass", visualization?.status === "pass" && fresh(visualization, now), visualization?.status || "missing");
  add("numeric_truth_promotion_eligible", numeric?.status === "pass" && numeric?.promotion_eligible === true && fresh(numeric, now), numeric?.source_truth_verdict || numeric?.status || "missing");
  add("fresh_sampled_mongo_parity", paritySample?.status === "pass"
    && /Mongo parity/i.test(String(paritySample?.scope || ""))
    && fresh(paritySample, now), paritySample?.status || "missing");
  const fullParityComplete = Number(parityFull?.totals?.count) > 0
    && Number(parityFull?.totals?.checked) === Number(parityFull?.totals?.count)
    && Number(parityFull?.totals?.failed) === 0;
  add("fresh_full_mongo_parity", parityFull?.status === "pass"
    && /full required-field parity/i.test(String(parityFull?.scope || ""))
    && parityFull?.partial_run === false
    && fullParityComplete
    && fresh(parityFull, now), parityFull ? {
    status: parityFull.status,
    partial_run: parityFull.partial_run,
    totals: parityFull.totals || null,
  } : "missing");
  const visualizationCounts = new Map((visualization?.checks || []).map((check) => [check.id, Number(check.source_total_count)]));
  const parityCollections = Object.entries(parityFull?.collections || {});
  const countMismatches = parityCollections
    .filter(([id]) => ["entities", "people", "transactions", "compass"].includes(id))
    .map(([id, collection]) => ({
      id,
      parity: Number(collection?.count),
      current: visualizationCounts.get(id),
    }))
    .filter((item) => !Number.isFinite(item.current) || item.current !== item.parity);
  const visualizationGenerated = Date.parse(String(visualization?.generated_at || ""));
  const parityGenerated = Date.parse(String(parityFull?.generated_at || ""));
  add("full_parity_source_counts_current", parityCollections.length >= 4
    && countMismatches.length === 0
    && Number.isFinite(visualizationGenerated)
    && Number.isFinite(parityGenerated)
    && visualizationGenerated >= parityGenerated,
  {
    parity_generated_at: parityFull?.generated_at || "missing",
    current_counts_generated_at: visualization?.generated_at || "missing",
    mismatches: countMismatches,
  });
  for (const [id, receipt, receiptOrigin] of [
    ["search", search, search?.source_backend_origin],
    ["visualization", visualization, visualization?.source_backend_origin],
    ["numeric", numeric, numeric?.origin],
    ["parity_sample", paritySample, paritySample?.backend_origin],
    ["parity_full", parityFull, parityFull?.backend_origin],
  ]) {
    const normalizedReceiptOrigin = normalizedSourceOrigin(receiptOrigin);
    add(`${id}_source_origin_matches`, Boolean(receipt)
      && normalizedReceiptOrigin === sourceOrigin,
    { expected: sourceOrigin, observed: normalizedReceiptOrigin || "missing" });
  }
  const stakeholderReceiptAuthorized = /^[a-f0-9]{64}$/i.test(stakeholderApprovalSha)
    && stakeholder?._receipt_sha256 === stakeholderApprovalSha;
  add("stakeholder_acceptance_for_release", stakeholder?.status === "pass"
    && stakeholder?.release_git_sha === acceptanceIdentity.git_sha
    && stakeholder?.asset_version === acceptanceIdentity.asset_version
    && fresh(stakeholder, now)
    && stakeholderReceiptAuthorized,
  stakeholder ? { status: stakeholder.status, receipt_sha256: stakeholder._receipt_sha256, authorized: stakeholderReceiptAuthorized } : "missing");

  if (mode === "production") {
    const expectedPinned = /^[a-f0-9]{40}$/i.test(expectedRelease.git_sha) && Boolean(expectedRelease.asset_version);
    add("expected_production_release_pinned", expectedPinned, expectedRelease);
    for (const [id, receipt] of [["search", search], ["visualization", visualization]]) {
      add(`${id}_live_release_identity_matches`, expectedPinned
        && receipt?.target_mode === "live"
        && receipt?.release_identity_pinned === true
        && receipt?.tested_release_git_sha === expectedRelease.git_sha
        && receipt?.tested_release_asset_version === expectedRelease.asset_version,
      receipt ? { target_mode: receipt.target_mode, git_sha: receipt.tested_release_git_sha, asset_version: receipt.tested_release_asset_version } : "missing");
    }
  } else {
    add("candidate_worktree_clean", identity.git_dirty === false, identity);
    add("candidate_asset_identity_present", Boolean(identity.asset_version), identity.asset_version);
    for (const [id, receipt] of [["search", search], ["visualization", visualization]]) {
      add(`${id}_candidate_identity_matches`, receipt?.target_mode === "local_candidate"
        && receipt?.candidate_identity?.git_sha === identity.git_sha
        && receipt?.candidate_identity?.git_dirty === false
        && receipt?.candidate_identity?.asset_version === identity.asset_version,
      receipt?.candidate_identity || "missing");
    }
  }

  const blockers = checks.filter((check) => check.status !== "PASS").map((check) => check.id);
  return { status: blockers.length ? "blocked" : "pass", promotion_eligible: blockers.length === 0, checks, blockers };
}

function selfTest() {
  const now = Date.parse("2026-07-31T16:00:00Z");
  const generated_at = "2026-07-31T15:59:00Z";
  const identity = { git_sha: "a".repeat(40), git_dirty: false, asset_version: "asset-1" };
  const candidateIdentity = { ...identity };
  const sourceOrigin = "https://dashboard.swfi.com";
  const base = {
    search: { status: "pass", generated_at, target_mode: "local_candidate", source_backend_origin: sourceOrigin, candidate_identity: candidateIdentity, required_cold_start_samples: 2, passed_cold_start_samples: 2, identity_consistent: true },
    visualization: {
      status: "pass",
      generated_at,
      target_mode: "local_candidate",
      source_backend_origin: sourceOrigin,
      candidate_identity: candidateIdentity,
      checks: [
        { id: "entities", source_total_count: 40 },
        { id: "people", source_total_count: 30 },
        { id: "transactions", source_total_count: 20 },
        { id: "compass", source_total_count: 10 },
      ],
    },
    numeric: { status: "pass", generated_at, origin: sourceOrigin, promotion_eligible: true, source_truth_verdict: "MATCH" },
    paritySample: { status: "pass", generated_at, backend_origin: sourceOrigin, scope: "record-level live API to Mongo parity by _id" },
    parityFull: {
      status: "pass",
      generated_at,
      backend_origin: sourceOrigin,
      scope: "full required-field parity from SWFIPN source API to Mongo by source id",
      partial_run: false,
      totals: { count: 100, checked: 100, failed: 0 },
      collections: {
        entities: { count: 40 },
        people: { count: 30 },
        transactions: { count: 20 },
        compass: { count: 10 },
      },
    },
    stakeholder: { status: "pass", generated_at, release_git_sha: identity.git_sha, asset_version: identity.asset_version, _receipt_sha256: "b".repeat(64) },
  };
  const production = {
    ...base,
    search: { status: "pass", generated_at, target_mode: "live", source_backend_origin: sourceOrigin, required_cold_start_samples: 2, passed_cold_start_samples: 2, identity_consistent: true, release_identity_pinned: true, tested_release_git_sha: identity.git_sha, tested_release_asset_version: identity.asset_version },
    visualization: { ...base.visualization, target_mode: "live", release_identity_pinned: true, tested_release_git_sha: identity.git_sha, tested_release_asset_version: identity.asset_version },
  };
  const cases = [
    evaluate({ mode: "candidate", receipts: base, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "pass",
    evaluate({ mode: "candidate", receipts: base, identity: { ...identity, git_dirty: true }, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: { ...base, numeric: { ...base.numeric, promotion_eligible: false } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: { ...base, stakeholder: null }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "blocked",
    evaluate({ mode: "production", receipts: production, identity, expectedRelease: { git_sha: identity.git_sha, asset_version: identity.asset_version }, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "pass",
    evaluate({ mode: "production", receipts: production, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: base, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "c".repeat(64), now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: { ...base, numeric: { ...base.numeric, origin: "https://wrong.example" } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("numeric_source_origin_matches"),
    evaluate({ mode: "candidate", receipts: { ...base, paritySample: { ...base.paritySample, backend_origin: "https://wrong.example" } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("parity_sample_source_origin_matches"),
    evaluate({ mode: "candidate", receipts: { ...base, search: { ...base.search, passed_cold_start_samples: 1 } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("search_cold_start_stability"),
    evaluate({ mode: "candidate", receipts: { ...base, parityFull: { ...base.parityFull, partial_run: true } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("fresh_full_mongo_parity"),
    evaluate({ mode: "candidate", receipts: { ...base, parityFull: { ...base.parityFull, totals: { count: 100, checked: 99, failed: 0 } } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("fresh_full_mongo_parity"),
    evaluate({ mode: "candidate", receipts: { ...base, parityFull: null }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("fresh_full_mongo_parity"),
    evaluate({ mode: "candidate", receipts: { ...base, visualization: { ...base.visualization, checks: base.visualization.checks.map((check) => check.id === "transactions" ? { ...check, source_total_count: 21 } : check) } }, identity, expectedRelease: {}, sourceOrigin, stakeholderApprovalSha: "b".repeat(64), now }).blockers.includes("full_parity_source_counts_current"),
  ];
  const result = { status: cases.every(Boolean) ? "pass" : "fail", checks: cases.length, passed: cases.filter(Boolean).length };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "pass") process.exitCode = 1;
}

function main() {
  fs.mkdirSync(output, { recursive: true });
  const mode = String(process.env.SWFIPN_RELEASE_GATE_MODE || "candidate").trim().toLowerCase();
  if (!new Set(["candidate", "production"]).has(mode)) throw new Error(`invalid_release_gate_mode:${mode}`);
  const receipts = Object.fromEntries(Object.entries(receiptFiles).map(([id, file]) => [id, readJson(file)]));
  const identity = currentIdentity();
  const expectedRelease = {
    git_sha: String(process.env.SWFIPN_RELEASE_GIT_SHA || "").trim(),
    asset_version: String(process.env.SWFIPN_RELEASE_ASSET_VERSION || "").trim(),
  };
  const sourceOrigin = normalizedSourceOrigin(process.env.SWFIPN_RELEASE_SOURCE_ORIGIN || "https://dashboard.swfi.com");
  if (!sourceOrigin) throw new Error("invalid_release_source_origin");
  const stakeholderApprovalSha = String(process.env.SWFIPN_STAKEHOLDER_ACCEPTANCE_SHA256 || "").trim();
  const result = evaluate({ mode, receipts, identity, expectedRelease, sourceOrigin, stakeholderApprovalSha });
  const receipt = {
    schema_version: "swfipn.july31_release_gate.v1",
    generated_at: new Date().toISOString(),
    mode,
    ...result,
    current_identity: identity,
    release_source_origin: sourceOrigin,
    receipt_paths: Object.fromEntries(Object.entries(receiptFiles).map(([id, file]) => [id, `output/${file}`])),
    bad_news: result.blockers,
    checked_scope: ["July_31_search", "section_visualizations", "numeric_truth", "sampled_Mongo_parity", "full_universe_Mongo_parity", "stakeholder_acceptance", "artifact_identity"],
    unchecked_scope: mode === "production" ? ["global_acceptance_outside_July_31_contract"] : ["deployed_production"],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, promotion_eligible: receipt.promotion_eligible, blockers: receipt.blockers, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exitCode = 1;
}

if (process.argv.includes("--self-test")) selfTest();
else main();
