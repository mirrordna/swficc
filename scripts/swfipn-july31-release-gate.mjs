#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "output");
const receiptPath = path.join(output, "swfipn-july31-release-gate-latest.json");
const maxAgeMs = 6 * 60 * 60 * 1000;

const receiptFiles = {
  search: "swfipn-canonical-search-browser-gate-latest.json",
  visualization: "swfipn-section-visualization-brd-gate-latest.json",
  numeric: "swfipn-numeric-truth-adversarial-latest.json",
  parity: "swfipn-record-level-parity-gate-latest.json",
  stakeholder: "swfipn-july31-stakeholder-acceptance-latest.json",
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(output, file), "utf8"));
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

function evaluate({ mode, receipts, identity, expectedRelease, now = Date.now() }) {
  const checks = [];
  const add = (id, ok, detail = null) => checks.push({ id, status: ok ? "PASS" : "BLOCKED", detail });
  const { search, visualization, numeric, parity, stakeholder } = receipts;
  const acceptanceIdentity = mode === "production" ? expectedRelease : identity;

  add("search_receipt_current_pass", search?.status === "pass" && fresh(search, now), search?.status || "missing");
  add("visualization_receipt_current_pass", visualization?.status === "pass" && fresh(visualization, now), visualization?.status || "missing");
  add("numeric_truth_promotion_eligible", numeric?.status === "pass" && numeric?.promotion_eligible === true && fresh(numeric, now), numeric?.source_truth_verdict || numeric?.status || "missing");
  add("fresh_full_mongo_parity", parity?.status === "pass" && /Mongo parity/i.test(String(parity?.scope || "")) && fresh(parity, now), parity?.status || "missing");
  add("stakeholder_acceptance_for_release", stakeholder?.status === "pass" && stakeholder?.release_git_sha === acceptanceIdentity.git_sha && stakeholder?.asset_version === acceptanceIdentity.asset_version && fresh(stakeholder, now), stakeholder?.status || "missing");

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
  const base = {
    search: { status: "pass", generated_at, target_mode: "local_candidate", candidate_identity: candidateIdentity },
    visualization: { status: "pass", generated_at, target_mode: "local_candidate", candidate_identity: candidateIdentity },
    numeric: { status: "pass", generated_at, promotion_eligible: true, source_truth_verdict: "MATCH" },
    parity: { status: "pass", generated_at, scope: "record-level live API to Mongo parity by _id" },
    stakeholder: { status: "pass", generated_at, release_git_sha: identity.git_sha, asset_version: identity.asset_version },
  };
  const production = {
    ...base,
    search: { status: "pass", generated_at, target_mode: "live", release_identity_pinned: true, tested_release_git_sha: identity.git_sha, tested_release_asset_version: identity.asset_version },
    visualization: { status: "pass", generated_at, target_mode: "live", release_identity_pinned: true, tested_release_git_sha: identity.git_sha, tested_release_asset_version: identity.asset_version },
  };
  const cases = [
    evaluate({ mode: "candidate", receipts: base, identity, expectedRelease: {}, now }).status === "pass",
    evaluate({ mode: "candidate", receipts: base, identity: { ...identity, git_dirty: true }, expectedRelease: {}, now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: { ...base, numeric: { ...base.numeric, promotion_eligible: false } }, identity, expectedRelease: {}, now }).status === "blocked",
    evaluate({ mode: "candidate", receipts: { ...base, stakeholder: null }, identity, expectedRelease: {}, now }).status === "blocked",
    evaluate({ mode: "production", receipts: production, identity, expectedRelease: { git_sha: identity.git_sha, asset_version: identity.asset_version }, now }).status === "pass",
    evaluate({ mode: "production", receipts: production, identity, expectedRelease: {}, now }).status === "blocked",
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
  const result = evaluate({ mode, receipts, identity, expectedRelease });
  const receipt = {
    schema_version: "swfipn.july31_release_gate.v1",
    generated_at: new Date().toISOString(),
    mode,
    ...result,
    current_identity: identity,
    receipt_paths: Object.fromEntries(Object.entries(receiptFiles).map(([id, file]) => [id, `output/${file}`])),
    bad_news: result.blockers,
    checked_scope: ["July_31_search", "section_visualizations", "numeric_truth", "Mongo_parity", "stakeholder_acceptance", "artifact_identity"],
    unchecked_scope: mode === "production" ? ["global_acceptance_outside_July_31_contract"] : ["deployed_production"],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, promotion_eligible: receipt.promotion_eligible, blockers: receipt.blockers, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exitCode = 1;
}

if (process.argv.includes("--self-test")) selfTest();
else main();
