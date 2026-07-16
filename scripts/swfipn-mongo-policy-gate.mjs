#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { isLocalMongoUri } from "./swfipn-mongo-policy.mjs";

const root = process.cwd();
const violations = [];
const mongoEnvironmentNames = [
  "MONGODB_URI",
  "MONGO_URI",
  "SWFI_MONGO_URI",
  "SWFI_MONGODB_URI",
  "SWFI_ATLAS_URI",
  "ATLAS_URI",
  "SWFIPN_RECORD_PARITY_MONGO_URI",
];

for (const name of mongoEnvironmentNames) {
  const value = process.env[name];
  if (value && isLocalMongoUri(value)) violations.push(`process environment ${name} points to local Mongo`);
}
for (const name of ["ALLOW_LOCAL_MONGO", "SWFIPN_RECORD_PARITY_ALLOW_LOCAL_MONGO"]) {
  if (/^(1|true|yes|on)$/i.test(String(process.env[name] || ""))) violations.push(`process environment attempts ${name}=true`);
}

const extensions = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".sh", ".yaml", ".yml"]);
const localUri = /mongodb(?:\+srv)?:\/\/[^\s'"`]*(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)/i;
const localOptIn = /^(?!\s*(?:#|\/\/))(?:\s*export\s+)?\s*(?:ALLOW_LOCAL_MONGO|SWFIPN_RECORD_PARITY_ALLOW_LOCAL_MONGO)\s*=\s*(?:1|true|yes|on)\b/im;
const bundledMongo = /(?:name:\s*swfi2-mongo\b|image:\s*mongo(?::|@)|kind:\s*StatefulSet[\s\S]{0,240}app:\s*swfi2-mongo\b)/i;

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (["node_modules", ".next", "out", "output", ".git", ".playwright-cli"].includes(name)) continue;
      walk(fullPath);
      continue;
    }
    if (!extensions.has(extname(name)) || name.includes("mongo-policy")) continue;
    const rel = relative(root, fullPath);
    const source = readFileSync(fullPath, "utf8");
    if (localUri.test(source)) violations.push(`${rel} contains a local Mongo URI`);
    if (localOptIn.test(source)) violations.push(`${rel} enables a local-Mongo bypass`);
    if ((rel.endsWith(".yaml") || rel.endsWith(".yml")) && bundledMongo.test(source)) {
      violations.push(`${rel} defines a bundled local Mongo workload`);
    }
  }
}

for (const directory of ["src", "scripts", "infra"]) {
  const fullPath = join(root, directory);
  if (existsSync(fullPath)) walk(fullPath);
}

const receipt = {
  status: violations.length ? "FAIL" : "PASS",
  local_mongo_allowed: false,
  checks: {
    process_environment_clean: !violations.some((item) => item.startsWith("process environment")),
    static_configuration_clean: !violations.some((item) => !item.startsWith("process environment")),
    bundled_mongo_absent: !violations.some((item) => item.includes("bundled local Mongo workload")),
    bypass_absent: !violations.some((item) => item.includes("bypass") || item.includes("attempts")),
  },
  violations,
};

console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.status === "PASS" ? 0 : 1);
