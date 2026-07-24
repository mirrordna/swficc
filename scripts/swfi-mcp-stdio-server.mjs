#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { executeTool } from "./swfi-mcp-policy-gateway.mjs";

const repoRoot = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json"), "utf8"));
const backendOrigin = String(process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const callerRole = String(process.env.SWFI_MCP_CALLER_ROLE || "swfi_mcp_client");
const dryRun = process.env.SWFI_MCP_DRY_RUN === "1";

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer().catch((error) => {
    writeError(null, -32603, error.message);
  });
});

process.stdin.on("end", () => process.exit(0));

async function drainBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!lengthMatch) {
      buffer = Buffer.alloc(0);
      throw new Error("Invalid MCP frame: missing Content-Length");
    }

    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;

    const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    const message = JSON.parse(raw);
    await handleMessage(message);
  }
}

async function handleMessage(message) {
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    writeResult(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "swfi-mcp-policy-gateway",
        version: "0.1.0",
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    writeResult(message.id, {
      tools: manifest.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema || { type: "object" },
        annotations: {
          readOnlyHint: tool.mode === "read_only",
          destructiveHint: false,
          idempotentHint: tool.mode === "read_only",
          openWorldHint: tool.mode === "read_only",
        },
      })),
    });
    return;
  }

  if (message.method === "tools/call") {
    const toolName = String(message.params?.name || "");
    const input = message.params?.arguments || {};
    const result = await executeTool(toolName, input, {
      dryRun,
      callerRole,
      backendOrigin,
    });
    writeResult(message.id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: result.status === "blocked",
    });
    return;
  }

  writeError(message.id, -32601, `Unsupported method: ${message.method}`);
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
