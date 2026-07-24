#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const workflowPath = path.join(cwd, ".github/workflows/swfipn-acceptance.yml");
const receiptPath = path.join(outputDir, "swfipn-ci-cd-gate-latest.json");
const workflow = fs.existsSync(workflowPath) ? fs.readFileSync(workflowPath, "utf8") : "";
const branch = commandText("git", ["branch", "--show-current"]).trim();
const headSha = commandText("git", ["rev-parse", "HEAD"]).trim();
const required = [
  "npm ci",
  "npx playwright install --with-deps chromium",
  "npm run lint",
  "npm run build",
  "npm run brd:npm-audit:high",
  "python3 -m pip install pymongo",
  "npm run db:indexes",
  "npm run brd:search:gate:public",
  "npm run brd:cdn:gate:public",
  "npm run closeout:gate:public",
  "actions/upload-artifact",
];

const checks = [
  {
    id: "workflow_exists",
    ok: Boolean(workflow),
    evidence: { path: ".github/workflows/swfipn-acceptance.yml" },
  },
  ...required.map((needle) => ({
    id: `workflow_contains_${needle.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase()}`,
    ok: workflow.includes(needle),
    evidence: { needle },
  })),
];
const failures = checks.filter((check) => !check.ok).map((check) => check.id);
const remoteRun = latestRemoteWorkflowRun(branch, headSha);
const remoteCiRunProven = Boolean(remoteRun.ok);
const receipt = {
  schema_version: "swfipn.ci_cd_gate.v1",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : remoteCiRunProven ? "pass" : "configured_pending_remote_run",
  no_secret_values_written: true,
  branch,
  head_sha: headSha,
  summary: {
    checks: checks.length,
    failures: failures.length,
    remote_ci_run_proven: remoteCiRunProven,
  },
  checks,
  remote_run: remoteRun,
  failures,
  caveat: remoteCiRunProven
    ? "GitHub reports a successful current workflow run for this branch/SHA."
    : "This proves CI/CD workflow configuration only. BRD PASS still requires a current successful remote CI run receipt.",
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, summary: receipt.summary }, null, 2));
if (failures.length) process.exit(1);

function commandText(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  return result.status === 0 ? result.stdout : "";
}

function latestRemoteWorkflowRun(currentBranch, currentSha) {
  if (!currentBranch) return { ok: false, reason: "missing_local_branch" };
  const result = spawnSync("gh", [
    "run",
    "list",
    "--workflow",
    "swfipn-acceptance.yml",
    "--branch",
    currentBranch,
    "--limit",
    "10",
    "--json",
    "databaseId,status,conclusion,headBranch,headSha,createdAt,updatedAt,url,name",
  ], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 45_000 });
  if (result.status !== 0) {
    return {
      ok: false,
      reason: "gh_run_list_failed",
      stderr: String(result.stderr || result.error?.message || "").slice(0, 500),
    };
  }
  let runs = [];
  try {
    runs = JSON.parse(result.stdout || "[]");
  } catch (error) {
    return { ok: false, reason: "gh_run_list_parse_failed", error: error.message };
  }
  const matching = runs.find((run) => !currentSha || run.headSha === currentSha) || runs[0] || null;
  if (!matching) return { ok: false, reason: "no_remote_workflow_runs_for_branch" };
  return {
    ok: matching.status === "completed" && matching.conclusion === "success" && (!currentSha || matching.headSha === currentSha),
    id: matching.databaseId,
    status: matching.status,
    conclusion: matching.conclusion,
    head_branch: matching.headBranch,
    head_sha: matching.headSha,
    created_at: matching.createdAt,
    updated_at: matching.updatedAt,
    url: matching.url,
    reason: matching.status === "completed" && matching.conclusion === "success"
      ? (!currentSha || matching.headSha === currentSha ? "" : "latest_success_is_not_current_sha")
      : "latest_run_not_success",
  };
}
