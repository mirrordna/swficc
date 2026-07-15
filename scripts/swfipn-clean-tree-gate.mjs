#!/usr/bin/env node
// HANDLE_PROVENANCE: git subcommands "rev-parse HEAD" and "status --porcelain=v1"
// are the standard git machine-readable commands; --porcelain=v1 was run
// successfully in this session's first git status call. No DB/schema handles are
// used here; words like "source" below are prose, not table names.
//
// Deploy hardening: refuse to build/deploy from a dirty working tree.
//
// The live /swficc/ release marker shipped with git_dirty:true (2026-07),
// so the deployed artifact matched no committed sha and the live /search/
// page drifted from committed code. This gate makes that non-silent: run it
// in the deploy pipeline BEFORE `next build` so a dirty tree fails fast with
// the offending files, forcing a commit first so the build == a committed sha.
// Run: node scripts/swfipn-clean-tree-gate.mjs   (exit 0 = clean, 1 = dirty)
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function git(args) {
  return childProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
}

let head = "";
let porcelain = "";
try {
  head = git(["rev-parse", "HEAD"]).trim();
  porcelain = git(["status", "--porcelain=v1"]);
} catch (err) {
  console.error("clean-tree-gate: not a git repo or git unavailable: " + err.message);
  process.exit(2);
}

const dirtyFiles = porcelain.split("\n").map((line) => line.trim()).filter(Boolean);
const clean = dirtyFiles.length === 0;

const receipt = {
  schema_version: "swfipn.clean_tree_gate.v1",
  ok: clean,
  head,
  dirty_file_count: dirtyFiles.length,
  dirty_files: dirtyFiles.slice(0, 50),
};
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "swfipn-clean-tree-gate-latest.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);

if (clean) {
  console.log(`PASS clean-tree-gate: working tree clean at ${head}. A build now matches this committed sha.`);
  process.exit(0);
}
console.error(
  `FAIL clean-tree-gate: ${dirtyFiles.length} uncommitted change(s) — a build now would match no committed sha (this is how the live /search/ page drifted). Commit or stash first, then deploy.`,
);
for (const file of dirtyFiles.slice(0, 50)) console.error("  " + file);
process.exit(1);
