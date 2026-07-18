import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployPath = "infra/digitalocean/scripts/deploy_acceptance.sh";
const composePath = "infra/digitalocean/compose.acceptance.yml";
const deploy = readFileSync(deployPath, "utf8");
const compose = readFileSync(composePath, "utf8");

const requiredDeployContracts = [
  ["untracked frontend dirty detection", 'status --porcelain --untracked-files=normal'],
  ["dirty source refusal", 'refusing deploy from dirty source'],
  ["previous release scope validation", '"$PREVIOUS_RELEASE" != "$REMOTE_ROOT/releases/"*'],
  ["new release nonexistence check", "test ! -e '$REMOTE_RELEASE'"],
  ["new release symlink rejection", "test ! -L '$REMOTE_RELEASE'"],
  ["health-waited activation", "up -d --wait --wait-timeout 240"],
  ["automatic previous-release restore", "activation failed; restoring previous release"],
  ["current target verification", "test \\\"\\$(readlink -f '$REMOTE_ROOT/current')\\\" = '$REMOTE_RELEASE'"],
  ["versioned deploy receipt", 'swfipn.strict_acceptance_deploy.v3'],
  ["rollback image receipt", 'rollback_images_present'],
];

for (const [label, marker] of requiredDeployContracts) {
  assert.ok(deploy.includes(marker), `${label} contract missing`);
}

assert.ok(
  compose.includes("swfipn/swfi2-backend:${SWFIPN_IMAGE_TAG:-acceptance}"),
  "backend image must be release-versioned",
);
assert.ok(
  compose.includes("swfipn/web:${SWFIPN_IMAGE_TAG:-acceptance}"),
  "frontend image must be release-versioned",
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
