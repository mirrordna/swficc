#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const workflowPath = path.join(cwd, ".github", "workflows", "swfipn-acceptance.yml");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-machine-independence-latest.json");
const workflow = fs.readFileSync(workflowPath, "utf8");

fs.mkdirSync(outputDir, { recursive: true });

const checks = [
  check("github_hosted_linux_runner", /runs-on:\s*ubuntu-latest/.test(workflow)),
  check("self_hosted_runner_forbidden", !/\bself-hosted\b/.test(workflow)),
  check("macos_runner_forbidden", !/runs-on:\s*macos-/.test(workflow)),
  check("user_home_paths_forbidden", !/\/Users\/|mirror-admin|~\//.test(workflow)),
  check("legacy_acceptance_alias_forbidden", !/swfipn\.activemirror\.ai/.test(workflow)),
  check("swfi_dashboard_is_public_target", /SWFIPN_ORIGIN=https:\/\/dashboard\.swfi\.com\/swficc\//.test(workflow)),
  check("swfi_dashboard_is_backend_target", /--backend https:\/\/dashboard\.swfi\.com/.test(workflow)),
  check("candidate_built_on_runner", /npm run build/.test(workflow)),
  check("production_ssh_forbidden", !/^\s*(?:ssh|scp|rsync)\b/m.test(workflow)),
  check("production_deploy_forbidden", !/deploy_acceptance_from_git|docker compose|ln -sfn/.test(workflow)),
  check("receipts_uploaded_by_runner", /uses:\s*actions\/upload-artifact@/.test(workflow) && /path:\s*output\//.test(workflow)),
];

const failures = checks.filter((item) => !item.ok).map((item) => item.id);
const receipt = {
  schema_version: "swfipn.machine_independence_gate.v1",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  scope: "authoritative_github_acceptance_workflow",
  guarantees: {
    mac_required_for_build: false,
    mac_required_for_qa: false,
    mac_required_for_receipts: false,
    production_mutation_allowed: false,
    public_data_boundary: "dashboard.swfi.com",
    canonical_backend_contract: "SWFI Mongo-backed service through dashboard.swfi.com",
  },
  workflow: path.relative(cwd, workflowPath),
  git: {
    repository: process.env.GITHUB_REPOSITORY || null,
    sha: process.env.GITHUB_SHA || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  },
  checks,
  failures,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, failures }, null, 2));
if (failures.length) process.exit(1);

function check(id, ok) {
  return { id, ok: Boolean(ok) };
}
