#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfi-mcp-stdio-smoke-latest.json");
const serverPath = path.join(repoRoot, "scripts", "swfi-mcp-stdio-server.mjs");

const server = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  env: { ...process.env, SWFI_MCP_DRY_RUN: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
let readBuffer = Buffer.alloc(0);
const pending = new Map();
const failures = [];

server.stdout.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk]);
  drainResponses();
});

server.stderr.on("data", (chunk) => {
  failures.push(`stderr:${chunk.toString("utf8").trim()}`);
});

function call(method, params = {}) {
  const id = nextId;
  nextId += 1;
  const payload = { jsonrpc: "2.0", id, method, params };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.stdin.write(body);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`timeout:${method}`));
    }, 5000);
  });
}

function drainResponses() {
  while (true) {
    const headerEnd = readBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = readBuffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!lengthMatch) {
      failures.push("invalid_response_frame");
      readBuffer = Buffer.alloc(0);
      return;
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (readBuffer.length < bodyEnd) return;
    const message = JSON.parse(readBuffer.slice(bodyStart, bodyEnd).toString("utf8"));
    readBuffer = readBuffer.slice(bodyEnd);
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const initialized = await call("initialize", {});
  const listed = await call("tools/list", {});
  const called = await call("tools/call", {
    name: "search_institutions",
    arguments: { query: "PIF", limit: 3 },
  });
  const mutation = await call("tools/call", {
    name: "create_content_draft",
    arguments: { title: "Draft", body: "Source-backed draft body.", evidence: [{ source: "dry-run://source" }] },
  });

  if (initialized.serverInfo?.name !== "swfi-mcp-policy-gateway") failures.push("initialize_server_name_mismatch");
  if (!Array.isArray(listed.tools) || listed.tools.length !== 13) failures.push("tools_list_count_mismatch");
  if (!String(called.content?.[0]?.text || "").includes('"status": "ok"')) failures.push("read_tool_not_ok");
  if (!String(mutation.content?.[0]?.text || "").includes('"status": "approval_required"')) failures.push("mutation_not_approval_required");

  server.stdin.end();
  server.kill();

  const receipt = {
    schema_version: "swfi.mcp_stdio_smoke.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      tools_listed: Array.isArray(listed.tools) ? listed.tools.length : 0,
      failures: failures.length,
    },
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  server.kill();
  console.error(error);
  process.exit(1);
});
