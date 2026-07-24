#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "out");
const outputDir = path.join(repoRoot, "output");
const version = sanitizeVersion(process.env.SWFIPN_ASSET_VERSION || new Date().toISOString());
const targetExtensions = new Set([".html", ".txt"]);
const assetPattern = /(\/swficc\/_next\/static\/chunks\/[^"'\\\]\s<>]+?\.(?:js|css))(?![?])/g;
const changed = [];

if (!fs.existsSync(outDir)) {
  console.error(`missing static export directory: ${outDir}`);
  process.exit(1);
}

for (const file of walk(outDir)) {
  if (!targetExtensions.has(path.extname(file))) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(assetPattern, `$1?v=${version}`);
  if (after === before) continue;
  fs.writeFileSync(file, after);
  changed.push(path.relative(repoRoot, file));
}

fs.mkdirSync(outputDir, { recursive: true });
const releaseMarker = writeReleaseMarker(version);
const receiptPath = path.join(outputDir, "swfipn-asset-version-latest.json");
const receipt = {
  schema_version: "swfipn.asset_version.v1",
  generated_at: new Date().toISOString(),
  status: changed.length ? "pass" : "fail",
  version,
  release_marker: path.relative(repoRoot, releaseMarker.path),
  release_marker_sha256: releaseMarker.sha256,
  git_sha: releaseMarker.git_sha,
  files_changed: changed.length,
  sample: changed.slice(0, 20),
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, version, files_changed: changed.length, receipt: receiptPath }, null, 2));
if (!changed.length) process.exit(1);

function writeReleaseMarker(assetVersion) {
  const markerPath = path.join(outDir, "swficc-release.json");
  const routeFiles = [
    ["home", "index.html"],
    ["comparisons", "comparisons/index.html"],
    ["profiles", "profiles/index.html"],
    ["transactions", "transactions/index.html"],
    ["mandates", "mandates/index.html"],
    ["research", "research/index.html"],
  ];
  const marker = {
    schema_version: "swfipn.release_marker.v1",
    generated_at: new Date().toISOString(),
    asset_version: assetVersion,
    git_sha: gitSha(),
    git_dirty: String(process.env.SWFIPN_GIT_DIRTY || "").trim() === "1",
    route_hashes: Object.fromEntries(routeFiles.map(([key, relative]) => {
      const file = path.join(outDir, relative);
      return [key, fs.existsSync(file) ? sha256(fs.readFileSync(file)) : ""];
    })),
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return { path: markerPath, sha256: sha256(fs.readFileSync(markerPath)), git_sha: marker.git_sha };
}

function gitSha() {
  const fromEnv = String(process.env.SWFIPN_GIT_SHA || "").trim();
  if (fromEnv && fromEnv !== "unknown") return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeVersion(value) {
  return value.replace(/[^0-9A-Za-z_-]/g, "");
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
