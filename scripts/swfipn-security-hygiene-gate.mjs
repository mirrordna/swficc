#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-security-hygiene-latest.json");

const checks = [];

function check(id, ok, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), evidence });
}

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fullPath));
    else out.push(fullPath);
  }
  return out;
}

const gitignore = readIfExists(".gitignore");
const dockerignore = readIfExists(".dockerignore");
check("gitignore_excludes_tmp", /^\/tmp\/$/m.test(gitignore));
check("gitignore_excludes_next_cache", /^\/\.next\/$/m.test(gitignore));
check("dockerignore_excludes_tmp", /^tmp$/m.test(dockerignore));
check("dockerignore_excludes_next_cache", /^\.next$/m.test(dockerignore));

const tmpFiles = walk(path.join(repoRoot, "tmp"));
const scrapedKeyFindings = [];
for (const filePath of tmpFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  if (/Api-Key|apiKey|api-key/i.test(text)) {
    scrapedKeyFindings.push(path.relative(repoRoot, filePath));
  }
}
check("tmp_contains_no_scraped_api_key_bundle", scrapedKeyFindings.length === 0, { files: scrapedKeyFindings });

const trackedRiskFiles = [
  "infra/self-contained/.env.example",
  "infra/self-contained/compose.yml",
  "infra/self-contained/kubernetes/swfipn-stack.template.yaml",
];
const hardSecretFindings = [];
for (const relativePath of trackedRiskFiles) {
  const text = readIfExists(relativePath);
  const matches = text.match(/mongodb(?:\+srv)?:\/\/(?!REPLACE|swfi2_root:REPLACE_ME|swfi2_root:replace-with)[^\s"']+|Api-Key\s*[:=]\s*['"][^'"]+['"]/gi);
  if (matches) hardSecretFindings.push({ file: relativePath, matches: matches.length });
}
check("self_contained_templates_have_no_real_secret_values", hardSecretFindings.length === 0, { files: hardSecretFindings });

const failures = checks.filter((row) => !row.ok);
const receipt = {
  schema_version: "swfipn.security_hygiene_gate.v1",
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  summary: { checks: checks.length, failures: failures.length },
  checks,
  failures,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, failures: failures.length, receipt: receiptPath }, null, 2));
if (failures.length) process.exit(1);
