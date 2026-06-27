#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-self-improvement-loop-latest.json");
const reportPath = path.join(outputDir, "swfipn-self-improvement-loop-latest.md");
const target = argValue("--target") || process.env.SWFIPN_LOOP_TARGET || "public";
const level = argValue("--level") || process.env.SWFIPN_LOOP_LEVEL || "smoke";
const includeDocker = hasArg("--docker") || process.env.SWFIPN_LOOP_DOCKER === "1";
const failFast = !hasArg("--no-fail-fast");
const generatedAt = new Date().toISOString();
const commandTimeoutMs = Number(process.env.SWFIPN_LOOP_COMMAND_TIMEOUT_MS || 1_200_000);
const coreRequiredFiles = [
  "package.json",
  "scripts/swfipn-product-truth-audit.mjs",
  "scripts/swfipn-source-truth-gate.mjs",
  "scripts/swfipn-doctrine-gate.mjs",
  "scripts/swfipn-visual-gate.mjs",
  "scripts/swfipn-e2e-gate.mjs",
  "scripts/swfipn-kp-acceptance-gate.mjs",
  "scripts/swfipn-runtime-staleness-gate.mjs",
  "scripts/swfipn-route-ledger-gate.mjs",
  "scripts/swfipn-data-validation-gate.mjs",
  "scripts/swfipn-share-gate.mjs",
  "scripts/swfipn-link-mapping-leakage-gate.mjs",
  "scripts/swfipn-visible-link-escape-gate.mjs",
  "scripts/swfipn-acceptance-stack.mjs",
  "scripts/swfipn-ml-loop-registry.mjs",
  "tools/loop-budget/swficc_acceptance_lock.py",
  "tools/loop-budget/loop_collapse_detector.py",
  "docs/swfipn-route-ledger.json",
  "docs/swfipn-data-validation-ledger.json",
];
const dockerRequiredFiles = [
  "Dockerfile",
  "docker-compose.swfipn.yml",
  "scripts/swfipn-container-healthcheck.py",
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function tail(value, max = 4000) {
  const text = String(value || "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function runCommand(id, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeout ?? commandTimeoutMs,
    maxBuffer: options.maxBuffer ?? 60 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  return {
    id,
    kind: "command",
    command: [command, ...args].join(" "),
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal || "",
    duration_ms: durationMs,
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr),
    error: result.error ? result.error.message : "",
  };
}

function checkRequiredFiles() {
  const requiredFiles = includeDocker ? [...coreRequiredFiles, ...dockerRequiredFiles] : coreRequiredFiles;
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
  return {
    id: "required_files",
    kind: "preflight",
    ok: missing.length === 0,
    required_files: requiredFiles,
    missing,
  };
}

function checkPackageScripts() {
  const requiredScripts = [
    "lint",
    "build",
    "source-truth:gate:public",
    "doctrine:gate:public",
    "visual:gate:public",
    "kp:gate:public",
    "e2e:gate:public",
    "runtime:staleness:public",
    "route:ledger:gate:public",
    "data:validation:gate:public",
    "map-leakage:gate:public",
    "link:escape:gate:public",
    "acceptance:stack:public",
    "acceptance-lock",
    "loop-collapse",
    "share:gate:public",
    "ml:loops",
    "truth:audit:public",
    "truth:audit:public:full",
  ];
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const missing = requiredScripts.filter((script) => !pkg.scripts?.[script]);
  return {
    id: "package_scripts",
    kind: "preflight",
    ok: missing.length === 0,
    required_scripts: requiredScripts,
    missing,
  };
}

function checkReceiptFreshness(filePath, maxAgeMs = 24 * 60 * 60 * 1000) {
  const absolute = path.join(repoRoot, filePath);
  if (!fs.existsSync(absolute)) {
    return { ok: false, file: filePath, missing: true };
  }
  const stat = fs.statSync(absolute);
  return {
    ok: Date.now() - stat.mtimeMs <= maxAgeMs,
    file: filePath,
    mtime: stat.mtime.toISOString(),
    age_ms: Math.round(Date.now() - stat.mtimeMs),
  };
}

function currentReceiptFreshness() {
  return [
    checkReceiptFreshness("output/swfipn-source-truth-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-doctrine-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-record-mirror-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-table-controls-proof-latest.json"),
    checkReceiptFreshness("output/swfipn-visual-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-kp-acceptance-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-e2e-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-route-ledger-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-data-validation-gate-latest.json"),
    checkReceiptFreshness("output/swfipn-ml-loop-registry-latest.json"),
    checkReceiptFreshness("output/swfipn-share-gate-latest.json"),
  ];
}

function firstFailure(steps) {
  return steps.find((step) => !step.ok) || null;
}

function nextSliceFor(failure) {
  if (!failure) return "No patch slice. All enforced gates passed.";
  if (failure.id === "required_files") return `Restore or create missing required files: ${failure.missing.join(", ")}`;
  if (failure.id === "package_scripts") return `Restore package scripts: ${failure.missing.join(", ")}`;
  if (failure.id === "lint") return "Patch the first ESLint failure only, then rerun self-improvement loop.";
  if (failure.id === "build") return "Patch the first Next build/type failure only, then rerun self-improvement loop.";
  if (failure.id === "product_truth_audit") return "Open output/swfipn-product-truth-audit-latest.md and patch the first failing product gate only.";
  if (failure.id.startsWith("docker_")) return "Patch Docker runtime health or container startup only; do not touch product features until Docker is green.";
  return `Patch failing step ${failure.id} only, then rerun the loop.`;
}

function classifyStatus(failures) {
  return failures.length ? "fail" : "pass";
}

function dockerComposeCommand() {
  const direct = spawnSync("docker-compose", ["version"], { encoding: "utf8" });
  if (direct.status === 0) return { command: "docker-compose", prefixArgs: [] };
  const plugin = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (plugin.status === 0) return { command: "docker", prefixArgs: ["compose"] };
  return null;
}

function runDockerProof(steps) {
  const compose = dockerComposeCommand();
  if (!compose) {
    steps.push({
      id: "docker_compose_available",
      kind: "docker",
      ok: false,
      error: "Neither docker-compose nor docker compose is available.",
    });
    return;
  }

  const project = `swfipn_loop_${Date.now()}`;
  const port = process.env.SWFIPN_LOOP_DOCKER_PORT || "8356";
  const composeArgs = [...compose.prefixArgs, "-p", project, "-f", "docker-compose.swfipn.yml"];
  const env = { SWFIPN_PUBLIC_PORT: port };
  const up = runCommand("docker_up", compose.command, [...composeArgs, "up", "-d", "--build", "swfipn"], {
    env,
    timeout: Number(process.env.SWFIPN_LOOP_DOCKER_TIMEOUT_MS || 1_200_000),
    maxBuffer: 80 * 1024 * 1024,
  });
  steps.push(up);
  if (!up.ok) {
    steps.push(runCommand("docker_down", compose.command, [...composeArgs, "down"], { env, timeout: 120_000 }));
    return;
  }

  const health = pollDockerHealth(project);
  steps.push(health);
  const product = checkDockerProduct(port);
  steps.push(product);
  const down = runCommand("docker_down", compose.command, [...composeArgs, "down"], { env, timeout: 180_000 });
  steps.push({ ...down, ok: down.ok, required_for_pass: false });
}

function pollDockerHealth(project) {
  const startedAt = Date.now();
  const deadline = Date.now() + Number(process.env.SWFIPN_LOOP_DOCKER_HEALTH_TIMEOUT_MS || 180_000);
  const samples = [];
  while (Date.now() < deadline) {
    const ps = spawnSync("docker", ["ps", "--filter", `name=${project}`, "--format", "{{.Names}}"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 15_000,
    });
    const name = ps.stdout.trim().split("\n").filter(Boolean)[0] || "";
    if (name) {
      const inspect = spawnSync("docker", ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}", name], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 15_000,
      });
      const status = inspect.stdout.trim();
      samples.push({ name, status });
      if (status === "healthy") {
        return {
          id: "docker_health",
          kind: "docker",
          ok: true,
          duration_ms: Date.now() - startedAt,
          samples,
        };
      }
      if (status === "unhealthy" || status === "exited") break;
    } else {
      samples.push({ name: "", status: "container_missing" });
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
  return {
    id: "docker_health",
    kind: "docker",
    ok: false,
    duration_ms: Date.now() - startedAt,
    samples,
  };
}

function checkDockerProduct(port) {
  const probe = spawnSync("python3", ["scripts/swfipn-container-healthcheck.py"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SWFIPN_PORT: port,
      SWFIPN_HEALTHCHECK_URL: `http://127.0.0.1:${port}/swficc/`,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    id: "docker_product_contract",
    kind: "docker",
    command: `SWFIPN_PORT=${port} python3 scripts/swfipn-container-healthcheck.py`,
    ok: probe.status === 0,
    exit_code: probe.status,
    stdout_tail: tail(probe.stdout),
    stderr_tail: tail(probe.stderr),
    error: probe.error ? probe.error.message : "",
  };
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN Self-Improvement Loop",
    "",
    `- Status: ${receipt.status.toUpperCase()}`,
    `- Target: ${receipt.target}`,
    `- Level: ${receipt.level}`,
    `- Docker proof: ${receipt.include_docker ? "yes" : "no"}`,
    `- Generated: ${receipt.generated_at}`,
    `- Next slice: ${receipt.next_slice}`,
    "",
    "| Step | Status | Duration |",
    "| --- | --- | ---: |",
  ];
  for (const step of receipt.steps) {
    lines.push(`| ${step.id} | ${step.ok ? "PASS" : "FAIL"} | ${step.duration_ms ? `${(step.duration_ms / 1000).toFixed(1)}s` : ""} |`);
  }
  if (receipt.failures.length) {
    lines.push("", "## First Failure", "");
    const failure = receipt.failures[0];
    lines.push(`- Step: \`${failure.id}\``);
    if (failure.command) lines.push(`- Command: \`${failure.command}\``);
    if (failure.error) lines.push(`- Error: \`${failure.error}\``);
    if (failure.stderr_tail) lines.push("", "```text", failure.stderr_tail.slice(-1800), "```");
    if (failure.stdout_tail) lines.push("", "```text", failure.stdout_tail.slice(-1800), "```");
  }
  lines.push("", "## Loop Law", "");
  lines.push("Patch only the first failing slice. Rerun this loop. Do not send a test link unless this receipt is PASS.");
  return `${lines.join("\n")}\n`;
}

function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!["local", "public"].includes(target)) {
    console.error(`Invalid --target ${target}. Expected local or public.`);
    process.exit(2);
  }
  if (!["smoke", "full"].includes(level)) {
    console.error(`Invalid --level ${level}. Expected smoke or full.`);
    process.exit(2);
  }
  const steps = [];

  steps.push(checkRequiredFiles());
  steps.push(checkPackageScripts());
  steps.push(runCommand("git_status", "git", ["status", "--short", "--branch"], { timeout: 60_000 }));
  steps.push(runCommand("node_version", "node", ["--version"], { timeout: 30_000 }));
  steps.push(runCommand("npm_version", "npm", ["--version"], { timeout: 30_000 }));

  let failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("lint", "npm", ["run", "lint"], { timeout: 600_000 }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("build", "npm", ["run", "build"], {
      env: {
        NEXT_PUBLIC_SWFI_BACKEND_URL: "same-origin",
        NEXT_PUBLIC_BACKEND_URL: "same-origin",
      },
      timeout: 1_200_000,
    }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    const auditArgs = ["scripts/swfipn-product-truth-audit.mjs", "--target", target, "--level", level];
    if (failFast) auditArgs.push("--fail-fast");
    steps.push(runCommand("product_truth_audit", "node", auditArgs, { timeout: 1_800_000 }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("ml_loop_registry", "npm", ["run", "ml:loops"], {
      env: { SWFIPN_ML_LOOP_LEVEL: level },
      timeout: 300_000,
    }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("runtime_staleness_gate", "npm", ["run", "runtime:staleness:public"], {
      timeout: 240_000,
    }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("route_ledger_gate", "npm", ["run", target === "public" ? "route:ledger:gate:public" : "route:ledger:gate"], {
      timeout: 420_000,
    }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("data_validation_gate", "npm", ["run", target === "public" ? "data:validation:gate:public" : "data:validation:gate"], {
      timeout: 300_000,
    }));
  }
  failure = firstFailure(steps);
  if (!failure || !failFast) {
    steps.push(runCommand("share_gate", "npm", ["run", target === "public" ? "share:gate:public" : "share:gate"], {
      timeout: 180_000,
    }));
  }
  failure = firstFailure(steps);
  if (includeDocker && (!failure || !failFast)) runDockerProof(steps);

  const requiredFailures = steps.filter((step) => !step.ok && step.required_for_pass !== false);
  const receiptFreshness = currentReceiptFreshness();
  const status = classifyStatus(requiredFailures);
  const nextSlice = nextSliceFor(requiredFailures[0]);
  const receipt = {
    schema_version: "swfipn.self_improvement_loop.v1",
    generated_at: generatedAt,
    target,
    level,
    include_docker: includeDocker,
    fail_fast: failFast,
    status,
    summary: {
      steps: steps.length,
      failures: requiredFailures.length,
      stale_receipts: receiptFreshness.filter((item) => !item.ok),
    },
    invariant: "No readiness claim without a PASS receipt. Patch only the first failing slice, then rerun.",
    next_slice: nextSlice,
    steps,
    failures: requiredFailures,
    recent_receipts: receiptFreshness,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdown(receipt));
  console.log(JSON.stringify({
    status: receipt.status,
    target,
    level,
    include_docker: includeDocker,
    summary: receipt.summary,
    next_slice: nextSlice,
    receipt: receiptPath,
    report: reportPath,
  }, null, 2));
  if (requiredFailures.length) process.exit(1);
}

run();
