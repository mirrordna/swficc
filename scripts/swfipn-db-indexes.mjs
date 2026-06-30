#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const candidates = [
  process.env.SWFIPN_PYTHON,
  path.join(cwd, ".venv/bin/python"),
  "/Users/mirror-pro/repos/SWFI2.0-final/.venv/bin/python",
  "python3",
].filter(Boolean);

let last = null;
for (const python of candidates) {
  const probe = spawnSync(python, ["-c", "import pymongo; print('ok')"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.status !== 0) {
    last = { python, stderr: String(probe.stderr || probe.error || "").trim() };
    continue;
  }
  const run = spawnSync(python, [path.join(cwd, "scripts/swfipn_mongo_indexes.py")], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  process.exit(run.status ?? 1);
}

const receipt = {
  schema_version: "swfipn.mongo_indexes.v1",
  generated_at: new Date().toISOString(),
  status: "blocked",
  no_secret_values_written: true,
  blocker: "pymongo_unavailable",
  attempted_python: candidates,
  last_error: last,
  finish_command: "MONGODB_URI='<write-uri>' npm run db:indexes",
};
const receiptPath = path.join(outputDir, "swfipn-mongo-indexes-latest.json");
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, blocker: receipt.blocker }, null, 2));
process.exit(2);
