#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-self-contained-stack-latest.json");

const checks = [];

function read(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function check(id, ok, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), evidence });
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

const compose = read("infra/self-contained/compose.yml");
const k8s = read("infra/self-contained/kubernetes/swfipn-stack.template.yaml");
const readme = read("infra/self-contained/README.md");
const acceptanceGate = read("scripts/swfipn-acceptance-criteria-gate.mjs");

check("compose_exists", compose.length > 0);
check(
  "compose_has_required_services",
  includesAll(compose, ["swfi2-key-store-init:", "swfi2-backend:", "swfipn-web:", "caddy:"]),
  { services: ["swfi2-key-store-init", "swfi2-backend", "swfipn-web", "caddy"] },
);
check("compose_forces_mongo_fact_source", compose.includes("SWFI2_FACT_SOURCE: mongo"));
check("compose_requires_remote_atlas", compose.includes("SWFI_MONGO_URI: ${SWFI_ATLAS_URI:?") && /approved remote Atlas URI/i.test(compose));
check("compose_uses_in_stack_backend", compose.includes("SWFIPN_BACKEND: http://swfi2-backend:8362"));
check("compose_rejects_host_dependency", !/host\.docker\.internal|localhost:8362/.test(compose));
check("compose_scopes_env_without_env_file_spray", !/env_file:/.test(compose));
check("compose_caddyfile_is_self_contained", compose.includes("./Caddyfile:/etc/caddy/Caddyfile:ro") && fs.existsSync(path.join(repoRoot, "infra/self-contained/Caddyfile")));
check("compose_has_no_mongo_workload", !/(^|\n)\s{2}mongo:|image:\s*mongo(?::|@)|mongodump|mongorestore|swfi2_mongo_data/.test(compose));
check("compose_has_healthchecks", (compose.match(/healthcheck:/g) || []).length >= 2);
check(
  "kubernetes_template_has_runtime_spine",
  includesAll(k8s, [
    "kind: Deployment",
    "name: swfi2-backend",
    "name: swfipn-web",
    "kind: Ingress",
  ]),
);
check("kubernetes_uses_registry_digest_images", /registry\.example\.com\/swfi2\/backend@sha256:REPLACE_BACKEND_DIGEST/.test(k8s) && /registry\.example\.com\/swfi2\/web@sha256:REPLACE_WEB_DIGEST/.test(k8s));
check("kubernetes_uses_remote_atlas_secret", k8s.includes("key: swfiAtlasUri") && !k8s.includes("key: swfiMongoUri"));
check("kubernetes_has_no_mongo_workload", !/kind:\s*(?:StatefulSet|CronJob)|image:\s*mongo(?::|@)|mongodump|mongorestore|name:\s*swfi2-mongo/.test(k8s));
check("kubernetes_rejects_host_dependency", !/host\.docker\.internal|localhost:8362/.test(k8s));
check("kubernetes_web_readiness_checks_origin_ready", k8s.includes("path: /swficc/__origin/ready"));
check("readme_declares_no_laptop_dependency", /must not depend on the laptop/i.test(readme));
check("readme_declares_no_local_mongo", /local or\s+in-stack Mongo process/i.test(readme) && /forbidden without exception/i.test(readme));
check("acceptance_gate_no_bare_404_false_positive", !/Not found\|404\/i/.test(acceptanceGate));

const failures = checks.filter((row) => !row.ok);
const receipt = {
  schema_version: "swfipn.remote_source_stack_gate.v2",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  summary: {
    checks: checks.length,
    failures: failures.length,
  },
  checks,
  failures,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, failures: failures.length, receipt: receiptPath }, null, 2));
if (failures.length) process.exit(1);
