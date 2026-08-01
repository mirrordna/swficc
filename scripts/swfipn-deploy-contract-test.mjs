import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployPath = "infra/digitalocean/scripts/deploy_acceptance.sh";
const composePath = "infra/digitalocean/compose.acceptance.yml";
const freshnessAuditPath = "infra/digitalocean/scripts/run_freshness_audit.sh";
const frontendOnlyDeployPath = "infra/digitalocean/scripts/deploy_frontend_only.sh";
const deploy = readFileSync(deployPath, "utf8");
const compose = readFileSync(composePath, "utf8");
const freshnessAudit = readFileSync(freshnessAuditPath, "utf8");
const frontendOnlyDeploy = readFileSync(frontendOnlyDeployPath, "utf8");

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

assert.ok(
  compose.includes("swfipn/swfi2-backend:${SWFI2_BACKEND_IMAGE_TAG:-acceptance}"),
  "backend image must have an independent immutable tag",
);
assert.ok(
  compose.includes("swfipn/web:${SWFIPN_FRONTEND_IMAGE_TAG:-acceptance}"),
  "frontend image must have an independent immutable tag",
);
assert.ok(deploy.includes("SWFI2_BACKEND_IMAGE_TAG=$STAMP"), "deploy must pin the backend image tag");
assert.ok(deploy.includes("SWFIPN_FRONTEND_IMAGE_TAG=$STAMP"), "deploy must pin the frontend image tag");
assert.ok(frontendOnlyDeploy.includes("up -d --no-deps --wait --wait-timeout 180 swfipn-web"), "frontend-only deploy must not restart dependencies");
assert.ok(frontendOnlyDeploy.includes("backend image changed during frontend-only deploy"), "frontend-only deploy must prove backend immutability");
assert.ok(frontendOnlyDeploy.includes("restoring exact previous web image"), "frontend-only deploy must restore the exact previous web image on failure");
assert.ok(frontendOnlyDeploy.includes("frontend_only_deploy.v1"), "frontend-only deploy must write a scoped receipt");
assert.ok(frontendOnlyDeploy.includes("npm run security:runtime-audit"), "frontend-only deploy must reject vulnerable runtime dependencies");
assert.ok(frontendOnlyDeploy.includes("npm run test:search-gateway"), "frontend-only deploy must run search hardening regressions");
assert.ok(frontendOnlyDeploy.includes("PREFLIGHT_IMAGE"), "frontend-only deploy must pin a DO preflight image");
assert.ok(frontendOnlyDeploy.includes("docker run --rm --network host"), "frontend-only deploy must run preflight inside DO");
assert.ok(frontendOnlyDeploy.includes("swfi-dashboard:/app:ro"), "DO preflight must not mutate transferred source");
assert.ok(!frontendOnlyDeploy.includes('(cd "$FRONTEND_REPO" && npm'), "frontend-only deploy must not require Node or npm on a control Mac");
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

console.log(JSON.stringify({
  status: "pass",
  deploy_contracts: requiredDeployContracts.map(([label]) => label),
  image_tags: "release_versioned",
  current_switch: "after_health_wait",
}));
