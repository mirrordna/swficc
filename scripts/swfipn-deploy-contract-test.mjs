import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const deployPath = "infra/digitalocean/scripts/deploy_acceptance.sh";
const gitDeployPath = "infra/digitalocean/scripts/deploy_acceptance_from_git.sh";
const baselinePath = "infra/digitalocean/acceptance-baseline.json";
const workflowPath = ".github/workflows/swfipn-deploy-acceptance.yml";
const acceptanceWorkflowPath = ".github/workflows/swfipn-acceptance.yml";
const composePath = "infra/digitalocean/compose.acceptance.yml";
const freshnessAuditPath = "infra/digitalocean/scripts/run_freshness_audit.sh";
const deploy = readFileSync(deployPath, "utf8");
const gitDeploy = readFileSync(gitDeployPath, "utf8");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const workflow = readFileSync(workflowPath, "utf8");
const acceptanceWorkflow = readFileSync(acceptanceWorkflowPath, "utf8");
const compose = readFileSync(composePath, "utf8");
const freshnessAudit = readFileSync(freshnessAuditPath, "utf8");

const digestFixture = mkdtempSync(path.join(tmpdir(), "swfipn-tree-digest-"));
try {
  mkdirSync(path.join(digestFixture, "nested"));
  writeFileSync(path.join(digestFixture, "alpha.txt"), "alpha\n");
  writeFileSync(path.join(digestFixture, "nested", "beta.txt"), "beta\n");
  chmodSync(path.join(digestFixture, "nested", "beta.txt"), 0o640);
  symlinkSync("../alpha.txt", path.join(digestFixture, "nested", "alpha-link"));

  const digestOnce = JSON.parse(execFileSync("python3", [
    "infra/digitalocean/scripts/tree_digest.py",
    digestFixture,
  ], { encoding: "utf8" }));
  const digestTwice = JSON.parse(execFileSync("python3", [
    "infra/digitalocean/scripts/tree_digest.py",
    digestFixture,
  ], { encoding: "utf8" }));
  assert.equal(digestOnce.sha256, digestTwice.sha256, "tree digest must be deterministic");
  assert.equal(digestOnce.files, 2, "tree digest must count files");
  assert.equal(digestOnce.symlinks, 1, "tree digest must count symlinks");

  writeFileSync(path.join(digestFixture, "nested", "beta.txt"), "changed\n");
  const changedDigest = JSON.parse(execFileSync("python3", [
    "infra/digitalocean/scripts/tree_digest.py",
    digestFixture,
  ], { encoding: "utf8" }));
  assert.notEqual(digestOnce.sha256, changedDigest.sha256, "tree digest must detect content changes");
} finally {
  rmSync(digestFixture, { recursive: true, force: true });
}

const failureReceiptDir = mkdtempSync(path.join(tmpdir(), "swfipn-deploy-receipt-"));
try {
  const failureReceiptPath = path.join(failureReceiptDir, "preflight.json");
  const failureRun = spawnSync("bash", [
    gitDeployPath,
    "preflight",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SWFIPN_HOST: "root@161.35.56.218",
      SWFIPN_DOMAIN: "swfipn.activemirror.ai",
      SWFIPN_FRONTEND_GIT_SHA: "not-a-commit",
      SWFIPN_DEPLOY_RECEIPT: failureReceiptPath,
    },
  });
  assert.equal(failureRun.status, 2, "invalid candidate preflight must fail closed");
  const failureReceipt = JSON.parse(readFileSync(failureReceiptPath, "utf8"));
  assert.equal(failureReceipt.schema_version, "swfipn.strict_acceptance_deploy.v6");
  assert.equal(failureReceipt.status, "fail");
  assert.equal(failureReceipt.mode, "preflight");
  assert.equal(failureReceipt.production_mutation_attempted, false);
  assert.equal(failureReceipt.active_release_changed, false);
  assert.match(failureReceipt.failure, /full lowercase commit sha/);
} finally {
  rmSync(failureReceiptDir, { recursive: true, force: true });
}

const requiredDeployContracts = [
  ["untracked frontend dirty detection", 'status --porcelain --untracked-files=normal'],
  ["dirty source refusal", 'refusing deploy from dirty source'],
  ["previous release scope validation", '"$PREVIOUS_RELEASE" != "$REMOTE_ROOT/releases/"*'],
  ["new release nonexistence check", "test ! -e '$REMOTE_RELEASE'"],
  ["new release symlink rejection", "test ! -L '$REMOTE_RELEASE'"],
  ["health-waited activation", "up -d --wait --wait-timeout 240"],
  ["automatic previous-release restore", "activation failed; restoring previous release"],
  ["current target verification", "test \\\"\\$(readlink -f '$REMOTE_ROOT/current')\\\" = '$REMOTE_RELEASE'"],
  ["versioned deploy receipt", 'swfipn.strict_acceptance_deploy.v5'],
  ["rollback image receipt", 'rollback_images_present'],
  ["daily freshness timer install", "systemctl enable --now swfipn-freshness-audit.timer"],
  ["pre-switch freshness audit", "/usr/local/sbin/swfipn-freshness-audit"],
  ["freshness receipt binding", 'freshness_audit_sha256'],
  ["immutable freshness receipt resolution", "readlink -f '$FRESHNESS_AUDIT_LATEST'"],
];

for (const [label, marker] of requiredDeployContracts) {
  assert.ok(deploy.includes(marker), `${label} contract missing`);
}

const requiredGitDeployContracts = [
  ["approved GitHub repository", "refusing unapproved frontend repository"],
  ["full candidate SHA", "must be a full lowercase commit sha"],
  ["pinned baseline release", "current release differs from pinned baseline"],
  ["pinned active frontend image", "active frontend image differs from pinned baseline"],
  ["pinned active backend image", "active backend image differs from pinned baseline"],
  ["host-side exact commit fetch", "fetch -q --depth=1 origin '$FRONTEND_GIT_SHA'"],
  ["host-side commit verification", "rev-parse FETCH_HEAD"],
  ["host-side git tree verification", "show -s --format=%T FETCH_HEAD"],
  ["backend source from current release", "cp -a '$PREVIOUS_RELEASE/SWFI2.0-final/.'"],
  ["backend source-copy digest parity", "backend snapshot copy digest mismatch"],
  ["source provenance manifest", "swfipn.release_source.v1"],
  ["real release directory", "test ! -L '$REMOTE_RELEASE'"],
  ["health-waited activation", "up -d --wait --wait-timeout 240"],
  ["automatic previous-release restore", "activation failed; restoring previous release"],
  ["public marker candidate attestation", "public release marker did not attest the candidate"],
  ["switch after public verification", "STAGE=\"current_switch\""],
  ["rollback image verification", "docker image inspect '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID'"],
  ["incomplete activation evidence restore", "activation evidence incomplete; restoring previous release"],
  ["receipt on every exit", "trap on_exit EXIT"],
  ["versioned deploy receipt", "swfipn.strict_acceptance_deploy.v6"],
  ["preflight receipt isolation", "swfipn-git-deploy-preflight-latest.json"],
  ["legacy receipt compatibility", '"backend_git_sha"'],
  ["explicit production mutation attempt flag", '"production_mutation_attempted"'],
  ["explicit active release change flag", '"active_release_changed"'],
  ["failed current switch restore", "current release switch failed; restoring previous release"],
];

for (const [label, marker] of requiredGitDeployContracts) {
  assert.ok(gitDeploy.includes(marker), `${label} GitHub deploy contract missing`);
}

assert.equal(baseline.schema_version, "swfipn.acceptance_baseline.v1");
assert.match(baseline.release, /^\/opt\/swfipn-acceptance\/releases\/[0-9TZ]+$/);
assert.match(baseline.frontend_git_sha, /^[0-9a-f]{40}$/);
assert.match(baseline.backend_git_sha, /^[0-9a-f]{40}$/);
assert.match(baseline.frontend_image_id, /^sha256:[0-9a-f]{64}$/);
assert.match(baseline.backend_image_id, /^sha256:[0-9a-f]{64}$/);

for (const marker of [
  "workflow_dispatch:",
  "environment: swfipn-acceptance",
  "DEPLOY_SWFIPN_ACCEPTANCE",
  'test "$CANDIDATE_SHA" = "$WORKFLOW_SHA"',
  "SWFIPN_ACCEPTANCE_SSH_KEY",
  "SWFIPN_ACCEPTANCE_KNOWN_HOSTS",
  "deploy_acceptance_from_git.sh preflight",
  "deploy_acceptance_from_git.sh deploy",
  "Remove ephemeral SSH identity",
  "npm run contract:gate:public",
  "npm run test:semantic-search-retest:public",
]) {
  assert.ok(workflow.includes(marker), `protected deployment workflow missing: ${marker}`);
}

for (const marker of [
  "--backend https://dashboard.swfi.com",
  "SWFIPN_CONTRACT_OUT=output/swfipn-dashboard20-e2e-contract-candidate.json",
  "SWFIPN_SEMANTIC_RECEIPT=output/swfipn-semantic-search-retest-candidate.json",
  "SWFIPN_SEARCH_PERFORMANCE_BLOCKING=0",
  "SWFIPN_CLOSEOUT_LATENCY_BLOCKING=0",
]) {
  assert.ok(acceptanceWorkflow.includes(marker), `acceptance workflow missing: ${marker}`);
}
assert.equal(
  acceptanceWorkflow.includes("swfipn.activemirror.ai"),
  false,
  "frozen acceptance workflow must use only the SWFI-owned public boundary",
);

assert.ok(
  compose.includes("swfipn/swfi2-backend:${SWFIPN_IMAGE_TAG:-acceptance}"),
  "backend image must be release-versioned",
);
assert.ok(
  compose.includes("swfipn/web:${SWFIPN_IMAGE_TAG:-acceptance}"),
  "frontend image must be release-versioned",
);
assert.ok(
  freshnessAudit.includes("--env HOME=/tmp/swfipn-freshness"),
  "freshness verifier must use a writable isolated home",
);
assert.ok(
  freshnessAudit.includes('"mode": "read_only_verification"'),
  "freshness receipt must label its read-only mode",
);
assert.ok(
  freshnessAudit.includes('"source_refresh_claimed": False'),
  "freshness receipt must not claim that source data was refreshed",
);
assert.ok(
  freshnessAudit.includes("latest_tmp.symlink_to(versioned.name)"),
  "latest freshness pointer must resolve to an immutable timestamped receipt",
);

const activationIndex = deploy.indexOf("up -d --wait --wait-timeout 240");
const currentSwitchIndex = deploy.indexOf("ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current'");
assert.ok(activationIndex >= 0 && currentSwitchIndex > activationIndex, "current must switch only after healthy activation");

const gitActivationIndex = gitDeploy.indexOf("STAGE=\"activation\"");
const gitPublicVerificationIndex = gitDeploy.indexOf("STAGE=\"public_release_verification\"");
const gitEvidenceIndex = gitDeploy.indexOf("STAGE=\"activation_evidence\"");
const gitCurrentSwitchIndex = gitDeploy.indexOf("STAGE=\"current_switch\"");
assert.ok(
  gitActivationIndex >= 0
    && gitPublicVerificationIndex > gitActivationIndex
    && gitEvidenceIndex > gitPublicVerificationIndex
    && gitCurrentSwitchIndex > gitEvidenceIndex,
  "GitHub deploy must switch current only after health, public marker, and evidence verification",
);

console.log(JSON.stringify({
  status: "pass",
  deploy_contracts: requiredDeployContracts.map(([label]) => label),
  github_deploy_contracts: requiredGitDeployContracts.map(([label]) => label),
  image_tags: "release_versioned",
  current_switch: "after_health_wait",
  github_current_switch: "after_health_and_public_marker",
  workflow: "manual_environment_approval_required",
  acceptance_source_boundary: "dashboard.swfi.com_only",
  tree_digest: "deterministic_and_change_sensitive",
  fail_closed_receipt: "verified_without_remote_mutation",
}));
