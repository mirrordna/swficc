#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-redis-cache-gate-latest.json");
const backendRoot = process.env.SWFI2_BACKEND_CONTEXT || path.resolve(cwd, "../SWFI2.0-final");
const composePath = path.join(cwd, "infra/digitalocean/compose.acceptance.yml");
const remoteHost = process.env.SWFIPN_REDIS_REMOTE_HOST || "";

const checks = [];

checks.push(fileContains({
  id: "backend_declares_redis_dependency",
  file: path.join(backendRoot, "pyproject.toml"),
  needles: ["redis>="],
}));
checks.push(fileContains({
  id: "backend_has_optional_redis_cache_service",
  file: path.join(backendRoot, "src/swfi2_final/services/cache.py"),
  needles: ["class JsonRedisCache", "from_url", "setex", "ping"],
}));
checks.push(fileContains({
  id: "backend_uses_redis_for_search_kpi_and_aggregate_cache",
  file: path.join(backendRoot, "src/swfi2_final/adapters/swfi_api.py"),
  needles: ["redis_cache.get(f\"search:", "dashboard_metrics:v1", "redis_cache.get(f\"aggregate:"],
}));
checks.push(fileContains({
  id: "compose_provisions_internal_redis",
  file: composePath,
  needles: ["swfipn-redis:", "redis:7.4-alpine", "SWFI2_REDIS_URL: redis://swfipn-redis:6379/0"],
}));

if (remoteHost) {
  checks.push(remoteCheck(remoteHost));
}

const failures = checks.filter((check) => !check.ok).map((check) => check.id);
const runtimeProven = checks.some((check) => check.id === "remote_redis_runtime_ping" && check.ok);
const receipt = {
  schema_version: "swfipn.redis_cache_gate.v1",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : runtimeProven ? "pass" : "configured_pending_deploy",
  no_secret_values_written: true,
  backend_root: backendRoot,
  remote_host_checked: remoteHost || null,
  summary: {
    checks: checks.length,
    failures: failures.length,
    runtime_redis_proven: runtimeProven,
  },
  checks,
  failures,
  caveat: runtimeProven
    ? "Redis runtime ping was proven on the target host."
    : "This proves code and compose configuration only. Runtime PASS requires SWFIPN_REDIS_REMOTE_HOST and a deployed Redis container.",
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, summary: receipt.summary }, null, 2));
if (receipt.status === "fail") process.exit(1);

function fileContains({ id, file, needles }) {
  let body = "";
  try {
    body = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { id, ok: false, evidence: { file, error: String(error.message || error) } };
  }
  const missing = needles.filter((needle) => !body.includes(needle));
  return { id, ok: missing.length === 0, evidence: { file, needles, missing } };
}

function remoteCheck(host) {
  const command = [
    "docker",
    "exec",
    "swfipn_acceptance-swfipn-redis-1",
    "redis-cli",
    "ping",
  ];
  try {
    const stdout = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, ...command], {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return {
      id: "remote_redis_runtime_ping",
      ok: stdout === "PONG",
      evidence: { host, command: command.join(" "), stdout },
    };
  } catch (error) {
    return {
      id: "remote_redis_runtime_ping",
      ok: false,
      evidence: {
        host,
        command: command.join(" "),
        error: String(error.stderr || error.message || error),
      },
    };
  }
}
