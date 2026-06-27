#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const jsonPath = path.join(outputDir, "swfipn-acceptance-lock-latest.json");
const markdownPath = path.join(outputDir, "swfipn-acceptance-lock-latest.md");
const target = argValue("--target") || process.env.SWFIPN_ACCEPTANCE_TARGET || "public";
const deploy = hasArg("--deploy") || process.env.SWFIPN_ACCEPTANCE_DEPLOY === "1";
const includeShare = hasArg("--share") || process.env.SWFIPN_ACCEPTANCE_SHARE === "1";
const skipBuild = hasArg("--skip-build") || process.env.SWFIPN_ACCEPTANCE_SKIP_BUILD === "1";
const port = Number(argValue("--port") || process.env.SWFIPN_ACCEPTANCE_PORT || 8399);
const publicOrigin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const localOrigin = normalizeOrigin(`http://127.0.0.1:${port}/swficc/`);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
let activeOrigin = target === "local" ? localOrigin : publicOrigin;
const commandTimeoutMs = Number(process.env.SWFIPN_ACCEPTANCE_COMMAND_TIMEOUT_MS || 1_200_000);
const expectedGc1Redirect = "https://www.swfi.com/v1/signin/?msg=auth&redirect=%2Fv1%2Fentities%2F5e39a581fcbe7e8ca723278c";
const remoteHost = process.env.SWFIPN_RUNTIME_REMOTE_HOST || process.env.SWFIPN_HOST || "swfipn-do";
const remoteRoot = process.env.SWFIPN_REMOTE_ROOT || "/opt/swfipn-acceptance";
const composeProject = process.env.SWFIPN_COMPOSE_PROJECT || "swfipn_acceptance";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function tail(value, max = 5000) {
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
    maxBuffer: options.maxBuffer ?? 80 * 1024 * 1024,
  });
  const finishedAt = Date.now();
  return {
    id,
    kind: "command",
    command: [command, ...args].join(" "),
    ok: result.status === 0,
    exit_code: result.status,
    signal: result.signal || "",
    duration_ms: finishedAt - startedAt,
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr),
    error: result.error ? result.error.message : "",
  };
}

function packageJsonCheck() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const required = [
      "build",
      "map-leakage:gate",
      "map-leakage:gate:public",
      "link:escape:gate",
      "link:escape:gate:public",
      "kp:gate",
      "kp:gate:public",
      "acceptance:gate",
      "acceptance:gate:public",
      "acceptance:stack:public",
      "acceptance:stack:deploy",
      "brd:api-dns:gate:public",
      "acceptance-lock",
      "loop-collapse",
    ];
    const missing = required.filter((script) => !pkg.scripts?.[script]);
    return {
      id: "package_json",
      kind: "preflight",
      ok: missing.length === 0,
      missing_scripts: missing,
    };
  } catch (error) {
    return { id: "package_json", kind: "preflight", ok: false, error: error.message };
  }
}

function gitCheck() {
  const result = runCommand("git_status", "git", ["status", "--short"]);
  return {
    ...result,
    ok: result.ok,
    dirty: result.stdout_tail.trim().split("\n").filter(Boolean),
  };
}

function gitDiffStats() {
  const result = spawnSync("git", ["diff", "--numstat"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
  });
  const files = [];
  let totalAdded = 0;
  let totalDeleted = 0;
  if (result.status === 0 && result.stdout) {
    for (const line of result.stdout.split("\n")) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const added = Number.parseInt(parts[0], 10);
      const deleted = Number.parseInt(parts[1], 10);
      const file = parts.slice(2).join("\t");
      const safeAdded = Number.isFinite(added) ? added : 0;
      const safeDeleted = Number.isFinite(deleted) ? deleted : 0;
      totalAdded += safeAdded;
      totalDeleted += safeDeleted;
      files.push({ file, added: safeAdded, deleted: safeDeleted });
    }
  }
  return {
    changed_file_count: files.length,
    total_added: totalAdded,
    total_deleted: totalDeleted,
    changed_files: files.slice(0, 150),
  };
}

function receiptSummary(file, allowedStatuses = ["pass", "complete", "pass_with_quarantine", "go", "go_with_caveat"]) {
  const absolute = path.join(outputDir, file);
  try {
    const body = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const inferredStatus = body.status || body.final_verdict || (body.collapse_detected === false ? "pass" : "");
    return {
      file,
      ok: allowedStatuses.includes(inferredStatus),
      status: inferredStatus,
      generated_at: body.generated_at || "",
      summary: body.summary || null,
      failures: Array.isArray(body.failures) ? body.failures.slice(0, 8) : [],
    };
  } catch (error) {
    return { file, ok: false, status: "missing", error: error.message };
  }
}

function readOutputJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(outputDir, file), "utf8"));
  } catch (error) {
    return { status: "missing", error: error.message };
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function deployReceipt() {
  const receipt = readOutputJson("swfipn-strict-acceptance-deploy-latest.json");
  if (receipt.status !== "pass" || !receipt.release) {
    return { ok: false, receipt, failures: [`deploy_receipt_${receipt.status || "missing"}`] };
  }
  return { ok: true, receipt, failures: [] };
}

function remoteCurrentProof() {
  if (target !== "public") return { id: "remote_current_release", kind: "remote", ok: true, skipped: true };
  const deploy = deployReceipt();
  if (!deploy.ok) return { id: "remote_current_release", kind: "remote", ok: false, failures: deploy.failures };
  const result = runCommand("remote_current_release", "ssh", [remoteHost, `readlink -f ${shellQuote(`${remoteRoot}/current`)}`], { timeout: 60_000 });
  const current = result.stdout_tail.trim();
  return {
    ...result,
    kind: "remote",
    remote_host: remoteHost,
    expected_release: deploy.receipt.release,
    current_release: current,
    ok: result.ok && current === deploy.receipt.release,
    failures: result.ok && current === deploy.receipt.release ? [] : [`current_release_${current || "missing"}_ne_${deploy.receipt.release}`],
  };
}

function parseComposePs(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text.split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

function serviceHealthy(service) {
  const state = String(service.State || service.state || "").toLowerCase();
  const health = String(service.Health || service.health || "").toLowerCase();
  if (state && state !== "running") return false;
  return !health || health === "healthy" || health === "running";
}

function remoteContainerProof() {
  if (target !== "public") return { id: "remote_container_health", kind: "remote", ok: true, skipped: true };
  const deploy = deployReceipt();
  if (!deploy.ok) return { id: "remote_container_health", kind: "remote", ok: false, failures: deploy.failures };
  const command = [
    `cd ${shellQuote(deploy.receipt.release)}`,
    `SWFIPN_DOMAIN=${shellQuote(new URL(publicOrigin).hostname)} docker compose -p ${shellQuote(composeProject)} -f compose.acceptance.yml ps --format json`,
  ].join(" && ");
  const result = runCommand("remote_container_health", "ssh", [remoteHost, command], { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 });
  const services = parseComposePs(result.stdout_tail);
  const failures = [];
  const expected = ["swfi2-backend", "swfipn-web", "caddy"];
  for (const name of expected) {
    const match = services.find((service) => String(service.Service || service.Name || service.Names || "").includes(name) || String(service.Name || "").includes(name));
    if (!match) {
      failures.push(`missing_service:${name}`);
      continue;
    }
    if (!serviceHealthy(match)) failures.push(`unhealthy_service:${name}:${match.State || ""}:${match.Health || ""}`);
  }
  return {
    ...result,
    kind: "remote",
    remote_host: remoteHost,
    release: deploy.receipt.release,
    services,
    failures,
    ok: result.ok && failures.length === 0,
  };
}

async function findFreePort(preferred) {
  if (await portAvailable(preferred)) return preferred;
  for (let candidate = preferred + 1; candidate < preferred + 50; candidate += 1) {
    if (await portAvailable(candidate)) return candidate;
  }
  throw new Error(`no_free_port_near_${preferred}`);
}

function portAvailable(candidate) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(candidate, "127.0.0.1");
  });
}

function startLocalServer(actualPort) {
  const child = spawn("python3", [
    "scripts/serve-static-with-headers.py",
    "--host", "127.0.0.1",
    "--port", String(actualPort),
    "--root", "out",
    "--backend", backendOrigin,
    "--backend-timeout", "30",
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  return { child, logs };
}

async function waitForOrigin(url, timeoutMs = 45_000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return { ok: true, status: response.status };
      lastError = `http_${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { ok: false, error: lastError || "timeout" };
}

async function releaseMarkerCheck() {
  const url = new URL("swficc-release.json", activeOrigin).href;
  try {
    const response = await fetch(url, { redirect: "manual" });
    const body = await response.text();
    const json = JSON.parse(body);
    return {
      id: "release_marker",
      kind: "http",
      ok: response.status === 200 && json.schema_version === "swfipn.release_marker.v1",
      status: response.status,
      url,
      asset_version: json.asset_version || "",
      generated_at: json.generated_at || "",
      git_dirty: json.git_dirty,
    };
  } catch (error) {
    return { id: "release_marker", kind: "http", ok: false, url, error: error.message };
  }
}

async function gc1RedirectCheck() {
  const url = new URL("profiles/detail/?slug=gc1-ventures&name=GC1+Ventures", activeOrigin).href;
  try {
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location") || "";
    return {
      id: "gc1_direct_handoff",
      kind: "http",
      ok: [302, 303, 307, 308].includes(response.status) && location === expectedGc1Redirect,
      status: response.status,
      url,
      expected_location: expectedGc1Redirect,
      actual_location: location,
    };
  } catch (error) {
    return { id: "gc1_direct_handoff", kind: "http", ok: false, url, error: error.message };
  }
}

async function gc1RenderedProof() {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const screenshot = path.join(outputDir, target === "public" ? "swfipn-public-gc1-link-proof.png" : "swfipn-local-gc1-link-proof.png");
  const proofReceipt = path.join(outputDir, target === "public" ? "swfipn-public-gc1-link-proof-latest.json" : "swfipn-local-gc1-link-proof-latest.json");
  const url = new URL("profiles/?filter=GC1%20Ventures", activeOrigin).href;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => document.body.innerText.includes("GC1 Ventures") && !/Loading/.test(document.body.innerText), null, { timeout: 90_000 });
    const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => (a.textContent || "").includes("GC1 Ventures"))
      .map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.href,
        raw: a.getAttribute("href") || "",
      })));
    await page.screenshot({ path: screenshot, fullPage: true });
    const ok = links.some((link) => link.href === expectedGc1Redirect || link.raw === expectedGc1Redirect);
    const result = { id: "gc1_rendered_link", kind: "browser", ok, status: response?.status() || 0, url, expected: expectedGc1Redirect, links, screenshot };
    fs.writeFileSync(proofReceipt, `${JSON.stringify({
      schema_version: "swfipn.public_gc1_link_proof.v1",
      generated_at: new Date().toISOString(),
      status: ok ? "pass" : "fail",
      url,
      http_status: response?.status() || 0,
      expected: expectedGc1Redirect,
      links,
      screenshot,
    }, null, 2)}\n`);
    return result;
  } catch (error) {
    fs.writeFileSync(proofReceipt, `${JSON.stringify({
      schema_version: "swfipn.public_gc1_link_proof.v1",
      generated_at: new Date().toISOString(),
      status: "fail",
      url,
      expected: expectedGc1Redirect,
      links: [],
      screenshot,
      error: error.message,
    }, null, 2)}\n`);
    return { id: "gc1_rendered_link", kind: "browser", ok: false, url, screenshot, error: error.message };
  } finally {
    await browser.close().catch(() => {});
  }
}

function npmGate(id, script, receipt, env = {}, allowedStatuses) {
  const result = runCommand(id, "npm", ["run", script], { env });
  const summary = receiptSummary(receipt, allowedStatuses);
  return {
    ...result,
    receipt: summary,
    ok: result.ok && summary.ok,
  };
}

function writeReceipt(steps) {
  const failures = steps.filter((step) => !step.ok);
  const receipt = {
    schema_version: "swfipn.acceptance_lock.v2",
    generated_at: new Date().toISOString(),
    target,
    origin: activeOrigin,
    status: failures.length ? "fail" : "pass",
    final_verdict: failures.length ? "no_go" : "go",
    blockers: failures.map((step) => step.id),
    sendable: failures.length === 0 && target === "public",
    deploy_requested: deploy,
    share_gate_requested: includeShare,
    working_tree_diff: gitDiffStats(),
    summary: {
      steps: steps.length,
      failures: failures.length,
      passed: steps.length - failures.length,
    },
    acceptance_matrix: [
      matrixRow("Public dashboard loads", "public_access", steps, ["release_marker"]),
      matrixRow("DO runtime current release and containers are healthy", "runtime_truth", steps, target === "public" ? ["remote_current_release", "remote_container_health", "runtime_staleness"] : []),
      matrixRow("Rows hand off to SWFI auth with canonical record redirect", "route_parity", steps, ["gc1_direct_handoff", "gc1_rendered_link", "map_leakage"]),
      matrixRow("No internal/source/debug language leaks in rendered routes", "leakage", steps, ["map_leakage", "link_escape"]),
      matrixRow("KP acceptance criteria pass", "kp_acceptance", steps, ["kp_acceptance"]),
      matrixRow("Full acceptance criteria pass", "acceptance_criteria", steps, ["acceptance_criteria"]),
      matrixRow("API DNS/key lifecycle has explicit production-host receipt", "api_dns_key_lifecycle", steps, target === "public" ? ["api_dns_key_lifecycle"] : []),
      matrixRow("Loop budget lock and collapse detector pass", "loop_lock", steps, ["acceptance_lock_tool", "loop_collapse"]),
      matrixRow("Share gate sendable", "share_gate", steps, includeShare ? ["share_gate"] : []),
    ],
    steps,
    failures,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(receipt));
  return receipt;
}

function matrixRow(requirement, id, steps, stepIds) {
  if (!stepIds.length) {
    return { id, requirement, status: "BLOCKED", evidence: "not_requested" };
  }
  const relevant = steps.filter((step) => stepIds.includes(step.id));
  const failures = relevant.filter((step) => !step.ok);
  return {
    id,
    requirement,
    status: relevant.length === stepIds.length && failures.length === 0 ? "PASS" : "FAIL",
    evidence: relevant.map((step) => step.receipt?.file || step.screenshot || step.url || step.command || step.id),
    failures: failures.map((step) => step.id),
  };
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN Acceptance Lock",
    "",
    `Generated: ${receipt.generated_at}`,
    `Target: ${receipt.target}`,
    `Origin: ${receipt.origin}`,
    `Status: ${receipt.status}`,
    `Verdict: ${receipt.final_verdict}`,
    `Sendable: ${receipt.sendable}`,
    "",
    "## Acceptance Matrix",
    "",
    "| Requirement | Status | Evidence |",
    "|---|---:|---|",
  ];
  for (const row of receipt.acceptance_matrix) {
    lines.push(`| ${row.requirement} | ${row.status} | ${(row.evidence || []).join("<br>")} |`);
  }
  lines.push("", "## Failures", "");
  if (!receipt.failures.length) {
    lines.push("None.");
  } else {
    for (const failure of receipt.failures) lines.push(`- ${failure.id}: ${failure.error || failure.stderr_tail || JSON.stringify(failure.failures || failure.receipt?.failures || [])}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const steps = [];
  let localServer = null;
  try {
    steps.push(packageJsonCheck());
    steps.push(gitCheck());

    if (target === "local" && !skipBuild) {
      steps.push(runCommand("build", "npm", ["run", "build"]));
      if (!steps.at(-1).ok) {
        const receipt = writeReceipt(steps);
        console.log(JSON.stringify({ status: receipt.status, receipt: jsonPath, markdown: markdownPath }, null, 2));
        process.exit(1);
      }
    }

    if (target === "local") {
      const actualPort = await findFreePort(port);
      activeOrigin = normalizeOrigin(`http://127.0.0.1:${actualPort}/swficc/`);
      localServer = startLocalServer(actualPort);
      const ready = await waitForOrigin(activeOrigin);
      steps.push({ id: "local_static_server", kind: "runtime", ok: ready.ok, origin: activeOrigin, ...ready, logs: tail(localServer.logs.join("")) });
      if (!ready.ok) {
        const receipt = writeReceipt(steps);
        console.log(JSON.stringify({ status: receipt.status, receipt: jsonPath, markdown: markdownPath }, null, 2));
        process.exit(1);
      }
    }

    if (deploy) {
      steps.push(runCommand("deploy_acceptance", "bash", ["infra/digitalocean/scripts/deploy_acceptance.sh"], {
        env: {
          SWFIPN_HOST: process.env.SWFIPN_HOST || "swfipn-do",
          SWFIPN_DOMAIN: new URL(publicOrigin).hostname,
        },
        timeout: Number(process.env.SWFIPN_ACCEPTANCE_DEPLOY_TIMEOUT_MS || 1_800_000),
        maxBuffer: 100 * 1024 * 1024,
      }));
      if (!steps.at(-1).ok) {
        const receipt = writeReceipt(steps);
        console.log(JSON.stringify({ status: receipt.status, receipt: jsonPath, markdown: markdownPath }, null, 2));
        process.exit(1);
      }
    }

    const gateEnv = target === "local"
      ? { SWFIPN_ORIGIN: activeOrigin }
      : { SWFIPN_ORIGIN: publicOrigin, SWFIPN_BACKEND_ORIGIN: backendOrigin };
    steps.push(await releaseMarkerCheck());
    steps.push(await gc1RedirectCheck());
    steps.push(await gc1RenderedProof());
    steps.push(remoteCurrentProof());
    steps.push(remoteContainerProof());
    const runtimeStaleness = runCommand("runtime_staleness", "node", ["scripts/swfipn-runtime-staleness-gate.mjs"], {
        env: {
          SWFIPN_ORIGIN: target === "public" ? publicOrigin : activeOrigin,
          SWFIPN_BACKEND_ORIGIN: backendOrigin,
          SWFIPN_RUNTIME_REMOTE_CHECK: target === "public" ? "1" : "0",
          SWFIPN_RUNTIME_REMOTE_HOST: remoteHost,
        },
        timeout: 300_000,
      });
    const runtimeReceipt = receiptSummary("swfipn-runtime-staleness-gate-latest.json");
    steps.push({ ...runtimeStaleness, receipt: runtimeReceipt, ok: runtimeStaleness.ok && runtimeReceipt.ok });
    steps.push(npmGate("map_leakage", target === "public" ? "map-leakage:gate:public" : "map-leakage:gate", "swfipn-link-mapping-leakage-gate-latest.json", gateEnv));
    steps.push(npmGate("link_escape", target === "public" ? "link:escape:gate:public" : "link:escape:gate", "swfipn-visible-link-escape-gate-latest.json", gateEnv));
    steps.push(npmGate("kp_acceptance", target === "public" ? "kp:gate:public" : "kp:gate", "swfipn-kp-acceptance-gate-latest.json", gateEnv));
    steps.push(npmGate("acceptance_criteria", target === "public" ? "acceptance:gate:public" : "acceptance:gate", "swfipn-acceptance-criteria-gate-latest.json", gateEnv));
    if (target === "public") {
      steps.push(npmGate(
        "api_dns_key_lifecycle",
        "brd:api-dns:gate:public",
        "swfipn-api-dns-key-lifecycle-latest.json",
        {
          SWFIPN_API_PRODUCTION_ORIGIN: "https://api.swfi.com",
          SWFIPN_API_ACCEPTANCE_ORIGIN: backendOrigin,
        },
        ["pass", "blocked"]
      ));
    }
    steps.push({
      ...runCommand("acceptance_lock_tool", "python3", [
        "tools/loop-budget/swficc_acceptance_lock.py",
        "--repo", ".",
        "--out", "output/swfipn-acceptance-lock-tool-latest.json",
        "--receipt", "output/swfipn-acceptance-criteria-gate-latest.json",
        "--receipt", "output/swfipn-kp-acceptance-gate-latest.json",
        "--receipt", "output/swfipn-link-mapping-leakage-gate-latest.json",
        "--receipt", "output/swfipn-visible-link-escape-gate-latest.json",
        "--receipt", "output/swfipn-runtime-staleness-gate-latest.json",
      ], { timeout: 120_000 }),
      receipt: receiptSummary("swfipn-acceptance-lock-tool-latest.json"),
    });
    writeReceipt(steps);
    steps.push({
      ...runCommand("loop_collapse", "python3", [
        "tools/loop-budget/loop_collapse_detector.py",
        "--repo", ".",
        "--out", "output/swfipn-loop-collapse-latest.json",
        "--acceptance-lock", "output/swfipn-acceptance-lock-latest.json",
      ], { timeout: 120_000 }),
      receipt: receiptSummary("swfipn-loop-collapse-latest.json"),
    });
    writeReceipt(steps);
    if (includeShare) {
      steps.push(npmGate("share_gate", "share:gate:public", "swfipn-share-gate-latest.json", { SWFIPN_ORIGIN: publicOrigin }));
    }

    const receipt = writeReceipt(steps);
    console.log(JSON.stringify({
      status: receipt.status,
      sendable: receipt.sendable,
      summary: receipt.summary,
      receipt: jsonPath,
      markdown: markdownPath,
    }, null, 2));
    process.exit(receipt.status === "pass" ? 0 : 1);
  } finally {
    if (localServer?.child && !localServer.child.killed) {
      localServer.child.kill("SIGINT");
    }
  }
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.acceptance_lock.v2",
    generated_at: new Date().toISOString(),
    target,
    origin: activeOrigin,
    status: "fail",
    error: error.stack || error.message,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(markdownPath, `# SWFIPN Acceptance Lock\n\nStatus: fail\n\n${error.stack || error.message}\n`);
  console.error(error);
  process.exit(1);
});
