import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const machineGatePath = "scripts/swfipn-machine-independence-gate.mjs";
const composePath = "infra/digitalocean/compose.acceptance.yml";
const freshnessAuditPath = "infra/digitalocean/scripts/run_freshness_audit.sh";
const backendEnvVerifierPath = "infra/digitalocean/scripts/verify_backend_env.py";
const rollbackGuardPath = "infra/digitalocean/scripts/rollback_guard.sh";
const deploy = readFileSync(deployPath, "utf8");
const gitDeploy = readFileSync(gitDeployPath, "utf8");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const workflow = readFileSync(workflowPath, "utf8");
const acceptanceWorkflow = readFileSync(acceptanceWorkflowPath, "utf8");
const compose = readFileSync(composePath, "utf8");
const freshnessAudit = readFileSync(freshnessAuditPath, "utf8");
const rollbackGuard = readFileSync(rollbackGuardPath, "utf8");

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

const backendEnvFixture = mkdtempSync(path.join(tmpdir(), "swfipn-backend-env-"));
try {
  const fixturePath = path.join(backendEnvFixture, "dns-fixture.json");
  const policyPath = path.join(backendEnvFixture, "mongo-policy.json");
  const policy = {
    schema_version: "swfipn.mongo_source_policy.v1",
    allowed_uri_hosts: [
      "cluster.example.net",
      "cluster-a.example.net",
      "cluster-b.example.net",
    ],
    allowed_srv_hosts: [
      "node-a.example.net",
      "node-b.example.net",
    ],
    allowed_resolved_ips: [
      "1.1.1.1",
      "8.8.8.8",
    ],
  };
  const fixture = {
    srv: {
      "cluster.example.net": [
        "node-a.example.net",
        "node-b.example.net",
      ],
    },
    addresses: {
      "cluster-a.example.net": ["8.8.8.8"],
      "cluster-b.example.net": ["8.8.8.8"],
      "node-a.example.net": ["8.8.8.8"],
      "node-b.example.net": ["1.1.1.1"],
    },
  };
  const policyJson = `${JSON.stringify(policy, null, 2)}\n`;
  writeFileSync(policyPath, policyJson);
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  const policyDigest = createHash("sha256").update(policyJson).digest("hex");

  const runVerifier = (name, lines, policyFile = policyPath, digest = policyDigest, dnsFixture = fixturePath) => {
    const envPath = path.join(backendEnvFixture, `${name}.env`);
    writeFileSync(envPath, [...lines, ""].join("\n"));
    return spawnSync(
      "python3",
      [backendEnvVerifierPath, envPath, policyFile, digest, dnsFixture],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SWFIPN_BACKEND_ENV_VERIFY_TEST_MODE: "1",
        },
      },
    );
  };

  const remoteResult = runVerifier("remote", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster.example.net",
  ]);
  assert.equal(
    remoteResult.status,
    0,
    `pinned remote Mongo source contract must pass: ${remoteResult.stdout || remoteResult.stderr}`,
  );
  const remoteReceipt = JSON.parse(remoteResult.stdout);
  assert.equal(remoteReceipt.schema_version, "swfipn.backend_env_verification.v2");
  assert.equal(remoteReceipt.policy_sha256, policyDigest);
  assert.equal(remoteReceipt.resolver_mode, "fixture");
  assert.equal(remoteResult.stdout.includes("user:secret"), false, "Mongo verifier must not expose credentials");
  assert.equal(remoteResult.stdout.includes("cluster.example.net"), false, "Mongo verifier must not expose host values");

  const identityA = runVerifier("identity-a", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  const identityB = runVerifier("identity-b", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-b.example.net:27017/swfi?tls=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-b.example.net",
  ]);
  assert.equal(identityA.status, 0);
  assert.equal(identityB.status, 0);
  assert.notEqual(
    JSON.parse(identityA.stdout).source_identity_sha256,
    JSON.parse(identityB.stdout).source_identity_sha256,
    "receipt digest must bind the verified Mongo source identity",
  );

  const wrongDigest = runVerifier(
    "wrong-policy-digest",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster.example.net",
    ],
    policyPath,
    "0".repeat(64),
  );
  assert.equal(wrongDigest.status, 1, "unpinned Mongo policy content must fail");

  const missingEnvAllowlist = runVerifier("missing-env-allowlist", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi",
  ]);
  assert.equal(missingEnvAllowlist.status, 1, "missing environment host allowlist must fail");

  const insecureTls = runVerifier("insecure-tls", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi?tls=false",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster.example.net",
  ]);
  assert.equal(insecureTls.status, 1, "Mongo TLS downgrade must fail");

  const missingDirectTls = runVerifier("missing-direct-tls", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(missingDirectTls.status, 1, "standard Mongo URI without explicit TLS must fail");

  const outsidePolicyFixturePath = path.join(backendEnvFixture, "outside-policy.dns.json");
  writeFileSync(outsidePolicyFixturePath, `${JSON.stringify({
    srv: {},
    addresses: {
      "cluster-a.example.net": ["9.9.9.9"],
    },
  }, null, 2)}\n`);
  const outsidePolicy = runVerifier(
    "outside-policy",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    policyPath,
    policyDigest,
    outsidePolicyFixturePath,
  );
  assert.equal(outsidePolicy.status, 1, "resolved address outside pinned policy must fail");

  const unauthorizedSrvFixturePath = path.join(backendEnvFixture, "unauthorized-srv.dns.json");
  writeFileSync(unauthorizedSrvFixturePath, `${JSON.stringify({
    srv: {
      "cluster.example.net": ["unauthorized.example.net"],
    },
    addresses: {
      "unauthorized.example.net": ["8.8.8.8"],
    },
  }, null, 2)}\n`);
  const unauthorizedSrv = runVerifier(
    "unauthorized-srv",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster.example.net",
    ],
    policyPath,
    policyDigest,
    unauthorizedSrvFixturePath,
  );
  assert.equal(unauthorizedSrv.status, 1, "SRV target outside pinned policy must fail");

  const fixtureBypassEnv = path.join(backendEnvFixture, "fixture-bypass.env");
  writeFileSync(fixtureBypassEnv, [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster.example.net/swfi",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster.example.net",
    "",
  ].join("\n"));
  const fixtureBypass = spawnSync(
    "python3",
    [backendEnvVerifierPath, fixtureBypassEnv, policyPath, policyDigest, fixturePath],
    { encoding: "utf8", env: { ...process.env, SWFIPN_BACKEND_ENV_VERIFY_TEST_MODE: "0" } },
  );
  assert.equal(fixtureBypass.status, 1, "DNS fixture must be unavailable outside explicit test mode");

  const unsafeHosts = [
    ["localhost.", "127.0.0.1"],
    ["127.0.0.2", "127.0.0.2"],
    ["127.1", "127.0.0.1"],
    ["[::ffff:127.0.0.1]", "::ffff:127.0.0.1"],
    ["%2Ftmp%2Fmongodb.sock", "127.0.0.1"],
    ["mongo", "127.0.0.1"],
    ["host.docker.internal", "127.0.0.1"],
    ["127.0.0.1.nip.io", "127.0.0.1"],
    ["localtest.me", "::1"],
    ["0x7f.0.0.1", "127.0.0.1"],
    ["0x7f.1", "127.0.0.1"],
  ];
  for (const [index, [unsafeHost, resolvedIp]] of unsafeHosts.entries()) {
    const unsafePolicyPath = path.join(backendEnvFixture, `unsafe-${index}.policy.json`);
    const unsafeFixturePath = `${unsafePolicyPath}.dns.json`;
    const normalizedUnsafeHost = unsafeHost.replace(/^\[|\]$/g, "");
    const unsafePolicyJson = `${JSON.stringify({
      schema_version: "swfipn.mongo_source_policy.v1",
      allowed_uri_hosts: [normalizedUnsafeHost],
      allowed_srv_hosts: [],
      allowed_resolved_ips: [resolvedIp],
    }, null, 2)}\n`;
    writeFileSync(unsafePolicyPath, unsafePolicyJson);
    writeFileSync(unsafeFixturePath, `${JSON.stringify({
      srv: {},
      addresses: {
        [normalizedUnsafeHost.replace(/\.$/, "")]: [resolvedIp],
      },
    }, null, 2)}\n`);
    const unsafeResult = runVerifier(
      `unsafe-${index}`,
      [
        "SWFI2_FACT_SOURCE=mongo",
        "SWFI_MONGO_DB=swfi",
        `SWFI_MONGO_URI=mongodb://${unsafeHost}:27017/swfi?tls=true`,
        `SWFI_MONGO_ALLOWED_HOSTS=${unsafeHost}`,
      ],
      unsafePolicyPath,
      createHash("sha256").update(unsafePolicyJson).digest("hex"),
      unsafeFixturePath,
    );
    assert.equal(unsafeResult.status, 1, `unsafe Mongo destination must fail: ${unsafeHost}`);
    assert.equal(unsafeResult.stdout.includes(`mongodb://${unsafeHost}`), false, "Mongo verifier must not expose rejected URI values");
  }
} finally {
  rmSync(backendEnvFixture, { recursive: true, force: true });
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
  assert.equal(failureReceipt.schema_version, "swfipn.strict_acceptance_deploy.v8");
  assert.equal(failureReceipt.status, "fail");
  assert.equal(failureReceipt.mode, "preflight");
  assert.equal(failureReceipt.production_mutation_attempted, false);
  assert.equal(failureReceipt.active_release_changed, false);
  assert.match(failureReceipt.failure, /full lowercase commit sha/);
} finally {
  rmSync(failureReceiptDir, { recursive: true, force: true });
}

const machineReceiptDir = mkdtempSync(path.join(tmpdir(), "swfipn-machine-receipt-"));
try {
  const eventPath = path.join(machineReceiptDir, "event.json");
  const receiptPath = path.join(machineReceiptDir, "receipt.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { head: {} } }));
  const missingHeadRun = spawnSync("node", [machineGatePath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: "a".repeat(40),
      SWFIPN_MACHINE_RECEIPT: receiptPath,
    },
  });
  assert.equal(missingHeadRun.status, 1, "PR execution must fail when pull_request.head.sha is absent");
  const missingHeadReceipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(missingHeadReceipt.git.candidate_sha, null);
  assert.ok(missingHeadReceipt.failures.includes("candidate_sha_recorded_in_github"));
} finally {
  rmSync(machineReceiptDir, { recursive: true, force: true });
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
  ["secret-safe Mongo source preflight", "backend Mongo source verification failed"],
  ["pinned Mongo policy digest", "SWFIPN_MONGO_POLICY_SHA256"],
  ["root-owned Mongo policy file", "mongo-source-policy.json"],
  ["live SRV resolver dependency", "import dns.resolver"],
  ["hardened source verifier container", "--cap-drop ALL --security-opt no-new-privileges"],
  ["source identity receipt binding", "source_identity_sha256"],
  ["effective destination receipt binding", "effective_destinations_sha256"],
  ["standalone source verification receipt", "swfipn-mongo-source-verification-latest.json"],
  ["host-side exact commit fetch", "fetch -q --depth=1 origin '$FRONTEND_GIT_SHA'"],
  ["host-side commit verification", "rev-parse FETCH_HEAD"],
  ["host-side git tree verification", "show -s --format=%T FETCH_HEAD"],
  ["pinned backend image reuse", "docker image tag '$BASELINE_BACKEND_IMAGE_ID'"],
  ["pinned backend image activation check", '[[ "$BACKEND_IMAGE_ID" == "$BASELINE_BACKEND_IMAGE_ID" ]]'],
  ["source provenance manifest", "swfipn.release_source.v2"],
  ["real release directory", "test ! -L '$REMOTE_RELEASE'"],
  ["health-waited activation", "up -d --wait --wait-timeout 240"],
  ["automatic previous-release restore", "activation failed; restoring previous release"],
  ["public marker candidate attestation", "public release marker did not attest the candidate"],
  ["switch after public verification", "STAGE=\"current_switch\""],
  ["rollback image verification", "docker image inspect '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID'"],
  ["incomplete activation evidence restore", "activation evidence incomplete; restoring previous release"],
  ["receipt on every exit", "trap on_exit EXIT"],
  ["exit-trap rollback", 'if [[ "$code" != "0" && "$ACTIVATION_STARTED" == "1"'],
  ["remote rollback guard", "systemd-run --quiet --unit '$ROLLBACK_GUARD_UNIT'"],
  ["serialized rollback lock", "flock -x 9"],
  ["rollback disables pulls and builds", "--pull never --no-build"],
  ["rollback frontend image verification", "PREVIOUS_FRONTEND_IMAGE_ID"],
  ["rollback backend image verification", "PREVIOUS_BACKEND_IMAGE_ID"],
  ["rollback guard disarm", "rollback guard disarm failed; restoring previous release"],
  ["Mongo source receipt binding", '"mongo_source"'],
  ["versioned deploy receipt", "swfipn.strict_acceptance_deploy.v8"],
  ["preflight receipt isolation", "swfipn-git-deploy-preflight-latest.json"],
  ["legacy receipt compatibility", '"backend_git_sha"'],
  ["explicit production mutation attempt flag", '"production_mutation_attempted"'],
  ["explicit active release change flag", '"active_release_changed"'],
  ["failed current switch restore", "current release switch failed; restoring previous release"],
];

for (const [label, marker] of requiredGitDeployContracts) {
  assert.ok(gitDeploy.includes(marker), `${label} GitHub deploy contract missing`);
}

for (const marker of [
  'flock -x 9',
  'docker image tag "$PREVIOUS_FRONTEND_IMAGE_ID"',
  'docker image tag "$PREVIOUS_BACKEND_IMAGE_ID"',
  '--pull never --no-build',
  "{{.Image}}",
]) {
  assert.ok(rollbackGuard.includes(marker), `remote rollback guard missing: ${marker}`);
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
  "SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256",
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
  "SWFIPN_SEARCH_SETTLE_TIMEOUT_MS=120000",
  "Prove Mac-independent read-only acceptance",
  "npm run acceptance:machine-independence",
  "SWFIPN_CLOSEOUT_LATENCY_BLOCKING=0",
]) {
  assert.ok(acceptanceWorkflow.includes(marker), `acceptance workflow missing: ${marker}`);
}
for (const [label, workflowSource] of [
  ["acceptance", acceptanceWorkflow],
  ["protected deployment", workflow],
]) {
  const actionReferences = [...workflowSource.matchAll(/^\s*uses:\s*([^\s#]+)/gm)]
    .map((match) => match[1]);
  assert.ok(actionReferences.length > 0, `${label} workflow must contain actions`);
  assert.ok(
    actionReferences.every((reference) => /@[0-9a-f]{40}$/.test(reference)),
    `${label} workflow actions must be pinned to immutable commit SHAs`,
  );
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
