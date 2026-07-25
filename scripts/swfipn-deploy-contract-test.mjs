import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const requiredOptions = {
    directconnection: ["true"],
    tls: ["true"],
  };
  const makePolicy = ({
    host = "cluster-a.example.net",
    port = 27017,
    ips = ["8.8.8.8"],
    pinIp = ips[0],
    options = requiredOptions,
  } = {}) => ({
    schema_version: "swfipn.mongo_source_policy.v3",
    connection_mode: "direct_single_endpoint",
    allowed_direct_endpoint: { host, port },
    allowed_resolved_ips: ips,
    runtime_dns_pin: { host, ip: pinIp },
    required_options: options,
  });
  const writePolicy = (filePath, policy) => {
    const policyJson = `${JSON.stringify(policy, null, 2)}\n`;
    writeFileSync(filePath, policyJson);
    return createHash("sha256").update(policyJson).digest("hex");
  };
  const policy = makePolicy();
  const fixture = {
    addresses: {
      "cluster-a.example.net": ["8.8.8.8"],
      "cluster-b.example.net": ["8.8.8.8"],
    },
  };
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  const policyDigest = writePolicy(policyPath, policy);

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
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(
    remoteResult.status,
    0,
    `pinned remote Mongo source contract must pass: ${remoteResult.stdout || remoteResult.stderr}`,
  );
  const remoteReceipt = JSON.parse(remoteResult.stdout);
  assert.equal(remoteReceipt.schema_version, "swfipn.backend_env_verification.v5");
  assert.equal(remoteReceipt.connection_mode, "direct_single_endpoint");
  assert.equal(remoteReceipt.policy_sha256, policyDigest);
  assert.equal(remoteReceipt.options_sha256, remoteReceipt.required_options_sha256);
  assert.equal(remoteReceipt.resolver_mode, "fixture");
  assert.equal(remoteResult.stdout.includes("user:secret"), false, "Mongo verifier must not expose credentials");
  assert.equal(remoteResult.stdout.includes("cluster-a.example.net"), false, "Mongo verifier must not expose host values");
  assert.equal(remoteResult.stdout.includes("8.8.8.8"), false, "Mongo verifier must not expose IP values");

  const identityA = runVerifier("identity-a", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  const policyBPath = path.join(backendEnvFixture, "mongo-policy-b.json");
  const policyBDigest = writePolicy(policyBPath, makePolicy({ host: "cluster-b.example.net" }));
  const identityB = runVerifier(
    "identity-b",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-b.example.net:27017/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-b.example.net",
    ],
    policyBPath,
    policyBDigest,
  );
  assert.equal(identityA.status, 0);
  assert.equal(identityB.status, 0);
  assert.notEqual(
    JSON.parse(identityA.stdout).source_identity_sha256,
    JSON.parse(identityB.stdout).source_identity_sha256,
    "receipt digest must bind the verified Mongo source identity",
  );

  const portPolicyPath = path.join(backendEnvFixture, "port-policy.json");
  const portPolicyDigest = writePolicy(portPolicyPath, makePolicy({ port: 22 }));
  const port27017 = identityA;
  const port22 = runVerifier(
    "port-22",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:22/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    portPolicyPath,
    portPolicyDigest,
  );
  assert.equal(port27017.status, 0);
  assert.equal(port22.status, 0);
  assert.notEqual(
    JSON.parse(port27017.stdout).source_identity_sha256,
    JSON.parse(port22.stdout).source_identity_sha256,
    "source identity must bind the direct Mongo port",
  );
  for (const invalidPort of ["0", "65536", "notaport"]) {
    const invalidPortResult = runVerifier(`invalid-port-${invalidPort}`, [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      `SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:${invalidPort}/swfi?tls=true&directConnection=true`,
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ]);
    assert.equal(invalidPortResult.status, 1, `invalid Mongo port must fail: ${invalidPort}`);
  }
  const unapprovedPort = runVerifier("unapproved-port", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:22/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(unapprovedPort.status, 1, "valid but unpinned Mongo port must fail");

  const wrongDigest = runVerifier(
    "wrong-policy-digest",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    policyPath,
    "0".repeat(64),
  );
  assert.equal(wrongDigest.status, 1, "unpinned Mongo policy content must fail");

  const missingEnvAllowlist = runVerifier("missing-env-allowlist", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
  ]);
  assert.equal(missingEnvAllowlist.status, 1, "missing environment host allowlist must fail");

  const insecureQueries = [
    "directConnection=true&tls=false",
    "directConnection=true&tls=true&tlsInsecure=true",
    "directConnection=true&tls=true&tlsAllowInvalidCertificates=true",
    "directConnection=true&tls=true&tlsAllowInvalidHostnames=true",
    "directConnection=true&tls=true&tlsDisableCertificateRevocationCheck=true",
    "directConnection=true&tls=true&tlsDisableOCSPEndpointCheck=true",
    "directConnection=true&tlsInsecure=true;tls=false",
    "directConnection=true&tlsAllowInvalidCertificates=true;tls=false",
    "directConnection=true&tlsAllowInvalidHostnames=true;tls=false",
  ];
  for (const [index, query] of insecureQueries.entries()) {
    const insecureTls = runVerifier(`insecure-tls-${index}`, [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      `SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?${query}`,
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ]);
    assert.equal(insecureTls.status, 1, `Mongo TLS relaxation must fail: ${query}`);
  }

  const routingQueries = [
    "tls=true&directConnection=false",
    "tls=true&directConnection=true&replicaSet=attacker",
    "tls=true&directConnection=true&srvMaxHosts=1",
    "tls=true&directConnection=true&srvServiceName=attacker",
    "tls=true&directConnection=true&loadBalanced=true",
    "tls=true&directConnection=true&proxyHost=attacker.example.net&proxyPort=1080",
    "tls=true&directConnection=true&proxyUsername=attacker&proxyPassword=secret",
    "tls=true&directConnection=true&retryWrites=true",
  ];
  for (const [index, query] of routingQueries.entries()) {
    const routingResult = runVerifier(`routing-option-${index}`, [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      `SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?${query}`,
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ]);
    assert.equal(routingResult.status, 1, `unpinned Mongo routing/options must fail: ${query}`);
  }
  const srvResult = runVerifier("srv-uri", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb+srv://user:secret@cluster-a.example.net/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(srvResult.status, 1, "SRV topology discovery must fail");
  const noncanonicalHostForms = [
    "cluster-a.example.net.",
    "CLUSTER-A.EXAMPLE.NET",
    "cluster%2Da.example.net",
  ];
  for (const [index, host] of noncanonicalHostForms.entries()) {
    const hostResult = runVerifier(`noncanonical-host-${index}`, [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      `SWFI_MONGO_URI=mongodb://user:secret@${host}:27017/swfi?tls=true&directConnection=true`,
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ]);
    assert.equal(hostResult.status, 1, `noncanonical Mongo hostname must fail: ${host}`);
  }

  const allowedExtraOptionsPath = path.join(backendEnvFixture, "allowed-extra-options-policy.json");
  const allowedExtraOptionsDigest = writePolicy(
    allowedExtraOptionsPath,
    makePolicy({
      options: {
        authsource: ["admin"],
        directconnection: ["true"],
        retrywrites: ["true"],
        tls: ["true"],
      },
    }),
  );
  const allowedExtraOptions = runVerifier(
    "allowed-extra-options",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?retryWrites=true&tls=true&authSource=admin&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    allowedExtraOptionsPath,
    allowedExtraOptionsDigest,
  );
  assert.equal(allowedExtraOptions.status, 0, "exactly policy-bound non-routing options should pass");

  const wrongCaseOptionValue = runVerifier(
    "wrong-case-option-value",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?retryWrites=true&tls=true&authSource=ADMIN&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    allowedExtraOptionsPath,
    allowedExtraOptionsDigest,
  );
  assert.equal(
    wrongCaseOptionValue.status,
    1,
    "case-sensitive Mongo option values must match the pinned policy exactly",
  );

  for (const [index, query] of [
    "tls=true&directConnection=true&retryWrites=true&retryWrites=true",
    "tls=true&directConnection=true&retryWrites=true&retryWrites=false",
    "tls=true&directConnection=true&retryWrites=false&retryWrites=true",
  ].entries()) {
    const duplicateOption = runVerifier(`duplicate-scalar-option-${index}`, [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      `SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?${query}`,
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ]);
    assert.equal(
      duplicateOption.status,
      1,
      `duplicate scalar Mongo options must fail regardless of value or order: ${query}`,
    );
  }

  const duplicateSeed = runVerifier("duplicate-seed", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017,cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(
    duplicateSeed.status,
    1,
    "direct Mongo mode must contain exactly one raw seed entry",
  );

  const invalidDuplicateOptionsPolicyPath = path.join(
    backendEnvFixture,
    "invalid-duplicate-options-policy.json",
  );
  const invalidDuplicateOptionsPolicyDigest = writePolicy(
    invalidDuplicateOptionsPolicyPath,
    makePolicy({
      options: {
        directconnection: ["true"],
        retrywrites: ["false", "true"],
        tls: ["true"],
      },
    }),
  );
  const invalidDuplicateOptionsPolicy = runVerifier(
    "invalid-duplicate-options-policy",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true&retryWrites=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    invalidDuplicateOptionsPolicyPath,
    invalidDuplicateOptionsPolicyDigest,
  );
  assert.equal(
    invalidDuplicateOptionsPolicy.status,
    1,
    "Mongo option policy must define exactly one value for each scalar option",
  );

  const duplicateJsonKeyPolicyPath = path.join(
    backendEnvFixture,
    "duplicate-json-key-policy.json",
  );
  const duplicateJsonKeyPolicy = `${JSON.stringify(makePolicy(), null, 2).replace(
    /  "connection_mode": "direct_single_endpoint",/,
    '  "connection_mode": "direct_single_endpoint",\n  "connection_mode": "direct_single_endpoint",',
  )}\n`;
  writeFileSync(duplicateJsonKeyPolicyPath, duplicateJsonKeyPolicy);
  const duplicateJsonKeyPolicyDigest = createHash("sha256")
    .update(duplicateJsonKeyPolicy)
    .digest("hex");
  const duplicateJsonKeyResult = runVerifier(
    "duplicate-json-key-policy",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    duplicateJsonKeyPolicyPath,
    duplicateJsonKeyPolicyDigest,
  );
  assert.equal(
    duplicateJsonKeyResult.status,
    1,
    "duplicate Mongo policy JSON keys must fail instead of using last-value precedence",
  );

  const missingDirectTls = runVerifier("missing-direct-tls", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(missingDirectTls.status, 1, "standard Mongo URI without explicit TLS must fail");
  const wrongDatabase = runVerifier("wrong-database", [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/other?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
  ]);
  assert.equal(wrongDatabase.status, 1, "Mongo URI database must be the canonical swfi database");

  const outsidePolicyFixturePath = path.join(backendEnvFixture, "outside-policy.dns.json");
  writeFileSync(outsidePolicyFixturePath, `${JSON.stringify({
    addresses: {
      "cluster-a.example.net": ["9.9.9.9"],
    },
  }, null, 2)}\n`);
  const outsidePolicy = runVerifier(
    "outside-policy",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    policyPath,
    policyDigest,
    outsidePolicyFixturePath,
  );
  assert.equal(outsidePolicy.status, 1, "resolved address outside pinned policy must fail");

  const pinMismatchFixturePath = path.join(backendEnvFixture, "pin-mismatch.dns.json");
  writeFileSync(pinMismatchFixturePath, `${JSON.stringify({
    addresses: {
      "cluster-a.example.net": ["8.8.8.8"],
    },
  }, null, 2)}\n`);
  const pinMismatchPolicyPath = path.join(backendEnvFixture, "pin-mismatch.policy.json");
  const pinMismatchPolicyDigest = writePolicy(
    pinMismatchPolicyPath,
    makePolicy({ ips: ["1.1.1.1", "8.8.8.8"], pinIp: "1.1.1.1" }),
  );
  const pinMismatch = runVerifier(
    "pin-mismatch",
    [
      "SWFI2_FACT_SOURCE=mongo",
      "SWFI_MONGO_DB=swfi",
      "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
      "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
    ],
    pinMismatchPolicyPath,
    pinMismatchPolicyDigest,
    pinMismatchFixturePath,
  );
  assert.equal(pinMismatch.status, 1, "runtime DNS pin absent from live resolution must fail");

  const fixtureBypassEnv = path.join(backendEnvFixture, "fixture-bypass.env");
  writeFileSync(fixtureBypassEnv, [
    "SWFI2_FACT_SOURCE=mongo",
    "SWFI_MONGO_DB=swfi",
    "SWFI_MONGO_URI=mongodb://user:secret@cluster-a.example.net:27017/swfi?tls=true&directConnection=true",
    "SWFI_MONGO_ALLOWED_HOSTS=cluster-a.example.net",
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
    const unsafePolicy = makePolicy({
      host: normalizedUnsafeHost,
      ips: [resolvedIp],
      pinIp: resolvedIp,
    });
    const unsafePolicyDigest = writePolicy(unsafePolicyPath, unsafePolicy);
    writeFileSync(unsafeFixturePath, `${JSON.stringify({
      addresses: {
        [normalizedUnsafeHost.replace(/\.$/, "")]: [resolvedIp],
      },
    }, null, 2)}\n`);
    const unsafeResult = runVerifier(
      `unsafe-${index}`,
      [
        "SWFI2_FACT_SOURCE=mongo",
        "SWFI_MONGO_DB=swfi",
        `SWFI_MONGO_URI=mongodb://${unsafeHost}:27017/swfi?tls=true&directConnection=true`,
        `SWFI_MONGO_ALLOWED_HOSTS=${unsafeHost}`,
      ],
      unsafePolicyPath,
      unsafePolicyDigest,
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
  assert.equal(failureReceipt.schema_version, "swfipn.strict_acceptance_deploy.v10");
  assert.equal(failureReceipt.status, "fail");
  assert.equal(failureReceipt.mode, "preflight");
  assert.equal(failureReceipt.production_mutation_attempted, false);
  assert.equal(failureReceipt.active_release_changed, false);
  assert.match(failureReceipt.failure, /full lowercase commit sha/);

  const validSha = "c".repeat(40);
  const defaultAssetReceiptPath = path.join(failureReceiptDir, "default-asset-version.json");
  const defaultAssetRun = spawnSync("bash", [gitDeployPath, "preflight"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SWFIPN_HOST: "root@example.invalid",
      SWFIPN_DOMAIN: "dashboard.swfi.com",
      SWFIPN_FRONTEND_GIT_SHA: validSha,
      SWFIPN_MONGO_POLICY_SHA256: "d".repeat(64),
      SWFIPN_BASELINE_MANIFEST: path.join(failureReceiptDir, "missing-baseline.json"),
      SWFIPN_DEPLOY_RECEIPT: defaultAssetReceiptPath,
    },
  });
  assert.equal(defaultAssetRun.status, 2, "valid candidate must reach baseline validation");
  const defaultAssetReceipt = JSON.parse(readFileSync(defaultAssetReceiptPath, "utf8"));
  assert.equal(defaultAssetReceipt.asset_version, validSha.slice(0, 7));
  assert.match(defaultAssetReceipt.failure, /missing baseline manifest/);
  assert.equal(defaultAssetReceipt.production_mutation_attempted, false);

  const mismatchedAssetReceiptPath = path.join(failureReceiptDir, "mismatched-asset-version.json");
  const mismatchedAssetRun = spawnSync("bash", [gitDeployPath, "preflight"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SWFIPN_HOST: "root@example.invalid",
      SWFIPN_DOMAIN: "dashboard.swfi.com",
      SWFIPN_FRONTEND_GIT_SHA: validSha,
      SWFIPN_ASSET_VERSION: "20260725T000000Z",
      SWFIPN_DEPLOY_RECEIPT: mismatchedAssetReceiptPath,
    },
  });
  assert.equal(mismatchedAssetRun.status, 2, "mismatched asset version must fail before SSH");
  const mismatchedAssetReceipt = JSON.parse(readFileSync(mismatchedAssetReceiptPath, "utf8"));
  assert.match(mismatchedAssetReceipt.failure, /candidate commit prefix/);
  assert.equal(mismatchedAssetReceipt.production_mutation_attempted, false);
} finally {
  rmSync(failureReceiptDir, { recursive: true, force: true });
}

const hardenedReleaseFixture = mkdtempSync(path.join(tmpdir(), "swfipn-release-hardening-"));
try {
  const fakeBin = path.join(hardenedReleaseFixture, "bin");
  const sshLog = path.join(hardenedReleaseFixture, "ssh.log");
  mkdirSync(fakeBin);
  const fakeSsh = path.join(fakeBin, "ssh");
  writeFileSync(fakeSsh, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "printf '%s\\n' \"$*\" >> \"$SWFIPN_TEST_SSH_LOG\"",
    "cat >> \"$SWFIPN_TEST_SSH_LOG\"",
    "printf '%s' \"${SWFIPN_TEST_SSH_STDOUT:-}\"",
    "",
  ].join("\n"));
  chmodSync(fakeSsh, 0o755);

  const earlyReceiptPath = path.join(hardenedReleaseFixture, "missing-access-input.json");
  const missingFingerprint = spawnSync("bash", [gitDeployPath, "authorize-access"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SWFIPN_HOST: "root@example.invalid",
      SWFIPN_SSH_ACCESS_RUN_ID: "test-run-1",
      SWFIPN_DEPLOY_RECEIPT: earlyReceiptPath,
      SWFIPN_TEST_SSH_LOG: sshLog,
    },
  });
  assert.equal(missingFingerprint.status, 2, "missing SSH fingerprint must fail before SSH");
  assert.equal(existsSync(sshLog), false, "missing SSH inputs must not invoke SSH");
  const earlyReceipt = JSON.parse(readFileSync(earlyReceiptPath, "utf8"));
  assert.equal(earlyReceipt.production_mutation_attempted, false);
  assert.match(earlyReceipt.failure, /OpenSSH SHA256 fingerprint/);

  const frontendSha = "a".repeat(40);
  const workflowRunId = "987654321";
  const markerSha = "d".repeat(64);
  const imageA = `sha256:${"1".repeat(64)}`;
  const imageB = `sha256:${"2".repeat(64)}`;
  const imageC = `sha256:${"3".repeat(64)}`;
  const releaseMarker = {
    url: "https://dashboard.swfi.com/swficc/swficc-release.json",
    schema_version: "swfipn.release_marker.v1",
    git_sha: frontendSha,
    asset_version: frontendSha.slice(0, 7),
    sha256: markerSha,
  };
  const requiredPages = [
    "/",
    "/profiles/",
    "/people/",
    "/transactions/",
    "/deals/",
    "/allocators/",
    "/comparisons/",
    "/mandates/",
    "/intelligence/",
    "/aggregates/",
    "/reports/",
  ];
  const requiredSemanticChecks = [
    "semantic_top_active_investors",
    "semantic_rfps_from_the_middle_east",
    "semantic_sovereign_wealth_funds_investing_in_ai",
    "semantic_pension_funds_in_europe",
    "semantic_open_manager_searches_in_emea",
    "semantic_central_banks_in_apac",
    "semantic_family_offices_deploying_capital_into_real_estate",
    "two_screen_transition",
    "detailed_category_refinement",
  ];
  const writeJson = (filePath, value) => {
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  };
  const makeActivationReceipt = (overrides = {}) => ({
    schema_version: "swfipn.strict_acceptance_deploy.v10",
    status: "pass",
    mode: "deploy",
    stage: "post_deploy_gates_pending",
    frontend_git_sha: frontendSha,
    backend_git_sha: "b".repeat(40),
    activation_started: true,
    deploy_committed: false,
    rollback_succeeded: false,
    rollback_guard_armed: true,
    release: "/opt/swfipn-acceptance/releases/20260725T000000Z",
    previous_release: "/opt/swfipn-acceptance/releases/20260723T123342Z",
    frontend_image_id: imageA,
    backend_image_id: imageB,
    previous_frontend_image_id: imageC,
    previous_backend_image_id: imageB,
    rollback_guard_unit: "swfipn-rollback-20260725T000000Z",
    asset_version: frontendSha.slice(0, 7),
    public_release_marker_sha256: markerSha,
    ...overrides,
  });
  const makeBrowserReceipt = (overrides = {}) => {
    const pages = requiredPages.map((page) => ({ page, status: "pass", failures: [] }));
    return {
      schema_version: "swfipn.dashboard20_e2e_contract.v1",
      generated_at: new Date().toISOString(),
      origin: "https://dashboard.swfi.com/swficc",
      candidate_sha: frontendSha,
      workflow_run_id: workflowRunId,
      release_marker: { ...releaseMarker },
      pages,
      summary: { pages: pages.length, passed: pages.length, failed: 0, failures: 0 },
      ...overrides,
    };
  };
  const makeSemanticReceipt = (overrides = {}) => ({
    schema_version: "swfipn.semantic_search_retest.v1",
    generated_at: new Date().toISOString(),
    origin: "https://dashboard.swfi.com",
    candidate_sha: frontendSha,
    workflow_run_id: workflowRunId,
    release_marker: { ...releaseMarker },
    status: "pass",
    failures: [],
    checks: requiredSemanticChecks.map((id) => ({ id, status: "PASS" })),
    ...overrides,
  });
  const activationReceiptPath = path.join(hardenedReleaseFixture, "activation.json");
  writeJson(activationReceiptPath, makeActivationReceipt());

  const badBrowserPath = path.join(hardenedReleaseFixture, "bad-browser.json");
  const semanticPath = path.join(hardenedReleaseFixture, "semantic.json");
  const badPages = makeBrowserReceipt().pages;
  badPages[0] = { page: "/", status: "fail", failures: ["fixture_failure"] };
  writeJson(badBrowserPath, makeBrowserReceipt({
    pages: badPages,
    summary: { pages: 11, passed: 10, failed: 1, failures: 1 },
  }));
  writeJson(semanticPath, makeSemanticReceipt());

  const baseFinalizeEnv = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    SWFIPN_HOST: "root@example.invalid",
    SWFIPN_DOMAIN: "dashboard.swfi.com",
    SWFIPN_FRONTEND_GIT_SHA: frontendSha,
    SWFIPN_WORKFLOW_RUN_ID: workflowRunId,
    SWFIPN_ACTIVATION_RECEIPT: activationReceiptPath,
    SWFIPN_BROWSER_GATE_RECEIPT: badBrowserPath,
    SWFIPN_SEMANTIC_GATE_RECEIPT: semanticPath,
    SWFIPN_SSH_KEY_FINGERPRINT: `SHA256:${"A".repeat(43)}`,
    SWFIPN_SSH_ACCESS_RUN_ID: "test-run-2",
    SWFIPN_TEST_SSH_LOG: sshLog,
    SWFIPN_TEST_SSH_STDOUT: "",
  };

  const failedFinalizeReceiptPath = path.join(hardenedReleaseFixture, "failed-finalize.json");
  const failedFinalize = spawnSync("bash", [gitDeployPath, "finalize"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_DEPLOY_RECEIPT: failedFinalizeReceiptPath,
    },
  });
  assert.equal(failedFinalize.status, 2, "failed gate receipts must block finalization");
  const failedFinalizeReceipt = JSON.parse(readFileSync(failedFinalizeReceiptPath, "utf8"));
  assert.equal(failedFinalizeReceipt.post_deploy_gates.passed, false);
  assert.equal(failedFinalizeReceipt.deploy_committed, false);
  assert.equal(failedFinalizeReceipt.rollback_attempted, true);
  assert.equal(failedFinalizeReceipt.rollback_succeeded, true);
  assert.match(readFileSync(sshLog, "utf8"), /--pull never --no-build/);

  const goodBrowserPath = path.join(hardenedReleaseFixture, "good-browser.json");
  writeJson(goodBrowserPath, makeBrowserReceipt());
  const injectionPayload = "'; printf RECEIPT_INJECTION_MARKER; #";
  for (const [field, value] of [
    ["schema_version", injectionPayload],
    ["status", injectionPayload],
    ["mode", injectionPayload],
    ["stage", injectionPayload],
    ["frontend_git_sha", injectionPayload],
    ["backend_git_sha", injectionPayload],
    ["release", injectionPayload],
    ["previous_release", injectionPayload],
    ["frontend_image_id", injectionPayload],
    ["backend_image_id", injectionPayload],
    ["previous_frontend_image_id", injectionPayload],
    ["previous_backend_image_id", injectionPayload],
    ["rollback_guard_unit", injectionPayload],
    ["asset_version", injectionPayload],
    ["public_release_marker_sha256", injectionPayload],
    ["activation_started", "true"],
    ["deploy_committed", "false"],
    ["rollback_succeeded", "false"],
    ["rollback_guard_armed", "true"],
  ]) {
    const poisonedActivationPath = path.join(hardenedReleaseFixture, `poisoned-${field}.json`);
    const poisonedReceiptPath = path.join(hardenedReleaseFixture, `poisoned-${field}-result.json`);
    writeJson(poisonedActivationPath, makeActivationReceipt({ [field]: value }));
    writeFileSync(sshLog, "");
    const poisonedRun = spawnSync("bash", [gitDeployPath, "rollback"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...baseFinalizeEnv,
        SWFIPN_ACTIVATION_RECEIPT: poisonedActivationPath,
        SWFIPN_DEPLOY_RECEIPT: poisonedReceiptPath,
      },
    });
    assert.equal(poisonedRun.status, 2, `invalid activation field must fail: ${field}`);
    assert.equal(readFileSync(sshLog, "utf8"), "", `invalid activation field must not reach SSH: ${field}`);
  }

  const invalidRelationshipPath = path.join(hardenedReleaseFixture, "invalid-release-relationship.json");
  writeJson(invalidRelationshipPath, makeActivationReceipt({
    previous_release: "/opt/swfipn-acceptance/releases/20260725T000000Z",
  }));
  writeFileSync(sshLog, "");
  const invalidRelationship = spawnSync("bash", [gitDeployPath, "rollback"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_ACTIVATION_RECEIPT: invalidRelationshipPath,
      SWFIPN_DEPLOY_RECEIPT: path.join(hardenedReleaseFixture, "invalid-release-relationship-result.json"),
    },
  });
  assert.equal(invalidRelationship.status, 2, "same release and previous release must fail");
  assert.equal(readFileSync(sshLog, "utf8"), "", "invalid release relationship must not reach SSH");
  assert.equal(readFileSync(sshLog, "utf8").includes("RECEIPT_INJECTION_MARKER"), false);

  const provenanceCases = [
    ["stale-browser", makeBrowserReceipt({ generated_at: "2000-01-01T00:00:00Z" }), makeSemanticReceipt()],
    ["wrong-browser-origin", makeBrowserReceipt({ origin: "https://example.invalid/swficc" }), makeSemanticReceipt()],
    ["wrong-semantic-origin", makeBrowserReceipt(), makeSemanticReceipt({ origin: "https://example.invalid" })],
    ["wrong-candidate", makeBrowserReceipt({ candidate_sha: "e".repeat(40) }), makeSemanticReceipt()],
    ["wrong-workflow-run", makeBrowserReceipt({ workflow_run_id: "123" }), makeSemanticReceipt()],
    [
      "wrong-release-marker",
      makeBrowserReceipt({ release_marker: { ...releaseMarker, sha256: "e".repeat(64) } }),
      makeSemanticReceipt(),
    ],
    [
      "partial-browser",
      makeBrowserReceipt({
        pages: makeBrowserReceipt().pages.slice(0, -1),
        summary: { pages: 10, passed: 10, failed: 0, failures: 0 },
      }),
      makeSemanticReceipt(),
    ],
    [
      "partial-semantic",
      makeBrowserReceipt(),
      makeSemanticReceipt({ checks: makeSemanticReceipt().checks.slice(0, -1) }),
    ],
  ];
  for (const [name, browserReceipt, semanticReceipt] of provenanceCases) {
    const browserPath = path.join(hardenedReleaseFixture, `${name}-browser.json`);
    const semanticReceiptPath = path.join(hardenedReleaseFixture, `${name}-semantic.json`);
    const deployReceiptPath = path.join(hardenedReleaseFixture, `${name}-finalize.json`);
    writeJson(browserPath, browserReceipt);
    writeJson(semanticReceiptPath, semanticReceipt);
    writeFileSync(sshLog, "");
    const result = spawnSync("bash", [gitDeployPath, "finalize"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...baseFinalizeEnv,
        SWFIPN_BROWSER_GATE_RECEIPT: browserPath,
        SWFIPN_SEMANTIC_GATE_RECEIPT: semanticReceiptPath,
        SWFIPN_DEPLOY_RECEIPT: deployReceiptPath,
      },
    });
    assert.equal(result.status, 2, `invalid post-deploy provenance must fail: ${name}`);
    const receipt = JSON.parse(readFileSync(deployReceiptPath, "utf8"));
    assert.equal(receipt.deploy_committed, false, `invalid provenance must not commit: ${name}`);
    assert.equal(receipt.rollback_attempted, true, `invalid provenance must retain rollback: ${name}`);
    assert.equal(receipt.rollback_succeeded, true, `invalid provenance rollback must be attempted: ${name}`);
  }

  const corruptActivationPath = path.join(hardenedReleaseFixture, "corrupt-activation.json");
  writeFileSync(corruptActivationPath, "{not-json\n");
  writeFileSync(sshLog, "");
  const corruptFinalize = spawnSync("bash", [gitDeployPath, "finalize"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_ACTIVATION_RECEIPT: corruptActivationPath,
      SWFIPN_DEPLOY_RECEIPT: path.join(hardenedReleaseFixture, "corrupt-finalize.json"),
    },
  });
  assert.equal(corruptFinalize.status, 2, "corrupt activation receipt must fail finalization");
  assert.equal(readFileSync(sshLog, "utf8"), "", "corrupt receipt must fail before finalize SSH");

  const corruptRunId = "corrupt-receipt-run";
  const corruptRevokeServerReceipt = {
    schema_version: "swfipn.ssh_access.v1",
    generated_at: "2026-07-25T00:00:00Z",
    run_id: corruptRunId,
    state: "revoked",
    key_fingerprint: `SHA256:${"A".repeat(43)}`,
    matches_before: 1,
    removed_count: 1,
    matches_after: 0,
    authorized_keys_sha256: "c".repeat(64),
    server_receipt_path: `/opt/swfipn-acceptance/access-receipts/swfipn-ssh-access-${corruptRunId}-revoked.json`,
    key_material_recorded: false,
    secret_values_recorded: false,
  };
  const corruptRevokeLocalReceipt = path.join(hardenedReleaseFixture, "corrupt-revoke-server.json");
  const corruptRevoke = spawnSync("bash", [gitDeployPath, "revoke-access"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_SSH_ACCESS_RUN_ID: corruptRunId,
      SWFIPN_DEPLOY_RECEIPT: path.join(hardenedReleaseFixture, "corrupt-revoke.json"),
      SWFIPN_SSH_ACCESS_SERVER_RECEIPT: corruptRevokeLocalReceipt,
      SWFIPN_TEST_SSH_STDOUT: `${JSON.stringify(corruptRevokeServerReceipt)}\n`,
    },
  });
  assert.equal(
    corruptRevoke.status,
    0,
    `corrupt activation must not block explicit access revocation: ${corruptRevoke.stderr}`,
  );
  assert.match(readFileSync(sshLog, "utf8"), new RegExp(`revoke.*${corruptRunId}`));
  const sshLogAfterFirstRevoke = readFileSync(sshLog, "utf8");
  const idempotentRevoke = spawnSync("bash", [gitDeployPath, "revoke-access"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_SSH_ACCESS_RUN_ID: corruptRunId,
      SWFIPN_DEPLOY_RECEIPT: path.join(hardenedReleaseFixture, "corrupt-revoke-idempotent.json"),
      SWFIPN_SSH_ACCESS_SERVER_RECEIPT: corruptRevokeLocalReceipt,
      SWFIPN_TEST_SSH_STDOUT: "",
    },
  });
  assert.equal(idempotentRevoke.status, 0, "repeat access revocation must be idempotent");
  assert.equal(readFileSync(sshLog, "utf8"), sshLogAfterFirstRevoke, "idempotent revoke must reuse valid server proof");

  const accessServerReceipt = {
    schema_version: "swfipn.ssh_access.v1",
    generated_at: "2026-07-25T00:00:00Z",
    run_id: "test-run-3",
    state: "revoked",
    key_fingerprint: `SHA256:${"A".repeat(43)}`,
    matches_before: 1,
    removed_count: 1,
    matches_after: 0,
    authorized_keys_sha256: "c".repeat(64),
    server_receipt_path: "/opt/swfipn-acceptance/access-receipts/swfipn-ssh-access-test-run-3-revoked.json",
    key_material_recorded: false,
    secret_values_recorded: false,
  };
  const successfulFinalizeReceiptPath = path.join(hardenedReleaseFixture, "successful-finalize.json");
  const successfulServerReceiptPath = path.join(hardenedReleaseFixture, "successful-server-revoke.json");
  writeFileSync(sshLog, "");
  const successfulFinalize = spawnSync("bash", [gitDeployPath, "finalize"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...baseFinalizeEnv,
      SWFIPN_BROWSER_GATE_RECEIPT: goodBrowserPath,
      SWFIPN_SSH_ACCESS_RUN_ID: "test-run-3",
      SWFIPN_DEPLOY_RECEIPT: successfulFinalizeReceiptPath,
      SWFIPN_SSH_ACCESS_SERVER_RECEIPT: successfulServerReceiptPath,
      SWFIPN_TEST_SSH_STDOUT: `${JSON.stringify(accessServerReceipt)}\n`,
    },
  });
  assert.equal(
    successfulFinalize.status,
    0,
    `passing gate receipts must permit receipt-bound finalization: ${successfulFinalize.stderr}`,
  );
  const successfulFinalizeReceipt = JSON.parse(readFileSync(successfulFinalizeReceiptPath, "utf8"));
  assert.equal(successfulFinalizeReceipt.status, "pass");
  assert.equal(successfulFinalizeReceipt.active_release_changed, true);
  assert.equal(successfulFinalizeReceipt.deploy_committed, true);
  assert.equal(successfulFinalizeReceipt.rollback_guard_armed, false);
  assert.equal(successfulFinalizeReceipt.post_deploy_gates.passed, true);
  assert.match(successfulFinalizeReceipt.post_deploy_gates.browser_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.match(successfulFinalizeReceipt.post_deploy_gates.semantic_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(successfulFinalizeReceipt.ssh_access.state, "revoked");
  assert.match(successfulFinalizeReceipt.ssh_access.server_receipt_sha256, /^[0-9a-f]{64}$/);
  assert.equal(successfulFinalizeReceipt.ssh_access.key_material_recorded, false);
  assert.equal(readFileSync(sshLog, "utf8").includes("RECEIPT_INJECTION_MARKER"), false);
} finally {
  rmSync(hardenedReleaseFixture, { recursive: true, force: true });
}

const reactLintFixture = mkdtempSync(path.join(process.cwd(), ".swfipn-react-lint-"));
try {
  const fixturePath = path.join(reactLintFixture, "fixture.jsx");
  const configPath = path.join(reactLintFixture, "eslint.config.mjs");
  const reactPluginUrl = pathToFileURL(path.resolve("node_modules/eslint-plugin-react/index.js")).href;
  writeFileSync(fixturePath, "export const Fixture = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n");
  writeFileSync(configPath, [
    `import react from ${JSON.stringify(reactPluginUrl)};`,
    "export default [{",
    "  files: ['**/*.jsx'],",
    "  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },",
    "  plugins: { react },",
    "  rules: { 'react/no-danger': 'error' },",
    "}];",
    "",
  ].join("\n"));
  const reactLint = spawnSync(
    path.resolve("node_modules/.bin/eslint"),
    ["--config", configPath, fixturePath],
    { cwd: reactLintFixture, encoding: "utf8" },
  );
  const reactLintOutput = `${reactLint.stdout}\n${reactLint.stderr}`;
  assert.equal(reactLint.status, 1, "react/no-danger fixture must produce its intended lint violation");
  assert.match(reactLintOutput, /react\/no-danger/, "react/no-danger must execute through the callable minimatch facade");
  assert.doesNotMatch(reactLintOutput, /minimatch is not a function|TypeError/, "ESLint consumer must not hit minimatch API errors");
} finally {
  rmSync(reactLintFixture, { recursive: true, force: true });
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
  ["runtime DNS pin extraction", "MONGO_RUNTIME_PIN_FIELDS"],
  ["runtime DNS pin policy rehash", "hashlib.sha256(b).hexdigest() == sys.argv[2]"],
  ["runtime DNS pin receipt binding", "runtime_dns_pin_sha256"],
  ["exact option policy binding", "required_options_sha256"],
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
  ["rollback remains armed through post-deploy gates", 'STAGE="post_deploy_gates_pending"'],
  ["serialized rollback lock", "flock -x 9"],
  ["rollback disables pulls and builds", "--pull never --no-build"],
  ["rollback frontend image verification", "PREVIOUS_FRONTEND_IMAGE_ID"],
  ["rollback backend image verification", "PREVIOUS_BACKEND_IMAGE_ID"],
  ["finalize requires armed rollback receipt", "activation receipt does not prove an armed rollback window"],
  ["finalize validates browser and semantic receipts", "validate_post_deploy_gate_receipts"],
  ["finalize revokes temporary access before commit", "ssh_access_contract revoke 1"],
  ["server-side SSH authorization receipt", "swfipn.ssh_access.v1"],
  ["server-side SSH key material exclusion", '"key_material_recorded": False'],
  ["atomic authorized-keys replacement", "os.replace(temporary_name, authorized_keys)"],
  ["server-side finalize error rollback", "trap rollback_on_error ERR"],
  ["Mongo source receipt binding", '"mongo_source"'],
  ["versioned deploy receipt", "swfipn.strict_acceptance_deploy.v10"],
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
  "preflight_only",
  "PREFLIGHT_SWFIPN_ACCEPTANCE",
  "DEPLOY_SWFIPN_ACCEPTANCE",
  'test "$CANDIDATE_SHA" = "$WORKFLOW_SHA"',
  "SWFIPN_ACCEPTANCE_SSH_KEY",
  "SWFIPN_ACCEPTANCE_KNOWN_HOSTS",
  "SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256",
  'missing+=("SWFIPN_ACCEPTANCE_HOST")',
  'missing+=("SWFIPN_ACCEPTANCE_DOMAIN")',
  'missing+=("SWFIPN_ACCEPTANCE_SSH_KEY")',
  'missing+=("SWFIPN_ACCEPTANCE_KNOWN_HOSTS")',
  'missing+=("SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256")',
  "Attest temporary server SSH authorization",
  "deploy_acceptance_from_git.sh authorize-access",
  "deploy_acceptance_from_git.sh preflight",
  "deploy_acceptance_from_git.sh deploy",
  "deploy_acceptance_from_git.sh finalize",
  "deploy_acceptance_from_git.sh rollback",
  "deploy_acceptance_from_git.sh revoke-access",
  "Remove ephemeral runner SSH identity",
  "npm run contract:gate:public",
  "npm run test:semantic-search-retest:public",
]) {
  assert.ok(workflow.includes(marker), `protected deployment workflow missing: ${marker}`);
}

const secretValidationIndex = workflow.indexOf("- name: Validate manual request and required secrets");
const checkoutIndex = workflow.indexOf("- name: Checkout exact candidate");
const authorizeIndex = workflow.indexOf("- name: Attest temporary server SSH authorization");
const preflightIndex = workflow.indexOf("- name: DigitalOcean immutable preflight");
const activationWorkflowIndex = workflow.indexOf("- name: Deploy exact GitHub commit");
const browserWorkflowIndex = workflow.indexOf("- name: Post-deploy frozen browser contract");
const semanticWorkflowIndex = workflow.indexOf("- name: Post-deploy semantic contract");
const finalizeWorkflowIndex = workflow.indexOf("- name: Finalize verified deployment");
const rollbackWorkflowIndex = workflow.indexOf("- name: Roll back any unfinalized deployment");
const guaranteedRevokeWorkflowIndex = workflow.indexOf("- name: Guarantee deploy-mode server access revocation");
const runnerCleanupWorkflowIndex = workflow.indexOf("- name: Remove ephemeral runner SSH identity");
assert.ok(
  secretValidationIndex >= 0 && checkoutIndex > secretValidationIndex,
  "complete secret validation must be the first step, before checkout or network work",
);
assert.ok(
  authorizeIndex > checkoutIndex
    && preflightIndex > authorizeIndex
    && activationWorkflowIndex > preflightIndex
    && browserWorkflowIndex > activationWorkflowIndex
    && semanticWorkflowIndex > browserWorkflowIndex
    && finalizeWorkflowIndex > semanticWorkflowIndex
    && rollbackWorkflowIndex > finalizeWorkflowIndex
    && guaranteedRevokeWorkflowIndex > rollbackWorkflowIndex
    && runnerCleanupWorkflowIndex > guaranteedRevokeWorkflowIndex,
  "protected workflow must authorize, preflight, activate, gate, finalize, then retain a rollback route",
);
assert.match(
  workflow.slice(guaranteedRevokeWorkflowIndex, runnerCleanupWorkflowIndex),
  /if:\s*\$\{\{\s*always\(\)\s*&&\s*inputs\.operation == 'deploy'\s*&&\s*steps\.ssh_identity\.outcome == 'success'\s*\}\}/,
  "deploy-mode access revocation must always run after finalize and rollback attempts",
);
assert.match(
  workflow.slice(activationWorkflowIndex, browserWorkflowIndex),
  /if:\s*\$\{\{\s*inputs\.operation == 'deploy'\s*\}\}/,
  "activation must be structurally excluded from preflight-only mode",
);
assert.match(
  workflow.slice(finalizeWorkflowIndex, rollbackWorkflowIndex),
  /SWFIPN_BROWSER_GATE_RECEIPT:[\s\S]*SWFIPN_SEMANTIC_GATE_RECEIPT:/,
  "finalization must bind both post-deploy gate receipts",
);

const validationRunMarker = "        run: |\n";
const validationRunStart = workflow.indexOf(validationRunMarker, secretValidationIndex);
const validationRunEnd = workflow.indexOf("\n\n      - name:", validationRunStart);
assert.ok(validationRunStart >= 0 && validationRunEnd > validationRunStart);
const validationScript = workflow
  .slice(validationRunStart + validationRunMarker.length, validationRunEnd)
  .split("\n")
  .map((line) => line.replace(/^          /, ""))
  .join("\n");
const missingSecretsRun = spawnSync("bash", ["-c", validationScript], {
  encoding: "utf8",
  env: {
    ...process.env,
    OPERATION: "preflight_only",
    CANDIDATE_SHA: "a".repeat(40),
    WORKFLOW_SHA: "a".repeat(40),
    APPROVAL_PHRASE: "PREFLIGHT_SWFIPN_ACCEPTANCE",
    SWFIPN_ACCEPTANCE_HOST: "",
    SWFIPN_ACCEPTANCE_DOMAIN: "",
    SWFIPN_ACCEPTANCE_SSH_KEY: "",
    SWFIPN_ACCEPTANCE_KNOWN_HOSTS: "",
    SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256: "",
  },
});
assert.equal(missingSecretsRun.status, 2, "missing workflow secrets must fail before checkout");
assert.match(missingSecretsRun.stderr, /Missing required deployment secrets \(5\)/);
for (const name of [
  "SWFIPN_ACCEPTANCE_HOST",
  "SWFIPN_ACCEPTANCE_DOMAIN",
  "SWFIPN_ACCEPTANCE_SSH_KEY",
  "SWFIPN_ACCEPTANCE_KNOWN_HOSTS",
  "SWFIPN_ACCEPTANCE_MONGO_POLICY_SHA256",
]) {
  assert.match(missingSecretsRun.stderr, new RegExp(` - ${name}(?:\\n|$)`));
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
  compose.includes("SWFIPN_MONGO_PINNED_HOST")
    && compose.includes("SWFIPN_MONGO_PINNED_IP")
    && compose.includes("extra_hosts:"),
  "backend container must pin the verified Mongo hostname to the approved IP",
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
const gitPendingGatesIndex = gitDeploy.lastIndexOf("STAGE=\"post_deploy_gates_pending\"");
assert.ok(
  gitActivationIndex >= 0
    && gitPublicVerificationIndex > gitActivationIndex
    && gitEvidenceIndex > gitPublicVerificationIndex
    && gitCurrentSwitchIndex > gitEvidenceIndex
    && gitPendingGatesIndex > gitCurrentSwitchIndex,
  "GitHub deploy must switch current only after health, public marker, and evidence verification",
);
assert.equal(
  /rm -f '\$REMOTE_RELEASE\/\.activation-pending'|systemctl stop '\$ROLLBACK_GUARD_UNIT/.test(
    gitDeploy.slice(gitCurrentSwitchIndex, gitPendingGatesIndex),
  ),
  false,
  "activation path must not disarm rollback before external post-deploy gates",
);
const finalizeModeIndex = gitDeploy.indexOf('if [[ "$MODE" == "finalize" ]]');
const validateGateIndex = gitDeploy.indexOf("validate_post_deploy_gate_receipts", finalizeModeIndex);
const revokeAndFinalizeIndex = gitDeploy.indexOf("ssh_access_contract revoke 1", finalizeModeIndex);
const commitIndex = gitDeploy.indexOf("DEPLOY_COMMITTED=1", finalizeModeIndex);
assert.ok(
  finalizeModeIndex >= 0
    && validateGateIndex > finalizeModeIndex
    && revokeAndFinalizeIndex > validateGateIndex
    && commitIndex > revokeAndFinalizeIndex,
  "finalize must validate gate receipts, revoke temporary access, then mark the deployment committed",
);

console.log(JSON.stringify({
  status: "pass",
  deploy_contracts: requiredDeployContracts.map(([label]) => label),
  github_deploy_contracts: requiredGitDeployContracts.map(([label]) => label),
  image_tags: "release_versioned",
  current_switch: "after_health_wait",
  github_current_switch: "after_health_and_public_marker_with_guard_armed",
  workflow: "manual_preflight_or_environment_approved_deploy",
  post_deploy_finalize: "after_browser_and_semantic_receipts",
  ssh_access_receipt: "server_authorized_then_revoked_without_key_material",
  acceptance_source_boundary: "dashboard.swfi.com_only",
  tree_digest: "deterministic_and_change_sensitive",
  fail_closed_receipt: "verified_without_remote_mutation",
}));
