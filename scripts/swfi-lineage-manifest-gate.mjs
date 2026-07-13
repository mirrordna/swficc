#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfi-lineage-manifest-latest.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json"), "utf8"));
const validationLedger = JSON.parse(fs.readFileSync(path.join(repoRoot, "docs", "swfipn-data-validation-ledger.json"), "utf8"));

function nodeId(type, id) {
  return `${type}:${id}`;
}

function addNode(nodes, type, id, attrs = {}) {
  const key = nodeId(type, id);
  if (!nodes.has(key)) nodes.set(key, { id: key, type, label: id, ...attrs });
  return key;
}

function addEdge(edges, from, to, relation, attrs = {}) {
  edges.push({ from, to, relation, ...attrs });
}

function run() {
  const failures = [];
  const nodes = new Map();
  const edges = [];
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  const modules = Array.isArray(validationLedger.modules) ? validationLedger.modules : [];

  const dashboard = addNode(nodes, "surface", "dashboard.swfi.com/swficc");
  const mcpSurface = addNode(nodes, "surface", "swfi-mcp");

  for (const module of modules) {
    const moduleNode = addNode(nodes, "dashboard_module", module.id || "unknown", {
      route: module.frontend_routes,
      endpoint: module.endpoint,
      freshness: module.freshness,
    });
    addEdge(edges, moduleNode, dashboard, "renders_on");

    if (!module.endpoint) failures.push(`${module.id || "unknown_module"}:missing_endpoint`);
    if (!Array.isArray(module.source_collections) || module.source_collections.length === 0) {
      failures.push(`${module.id || "unknown_module"}:missing_source_collections`);
    }

    const endpointNode = addNode(nodes, "endpoint", module.endpoint || "missing");
    addEdge(edges, endpointNode, moduleNode, "feeds");
    for (const source of module.source_collections || []) {
      const sourceNode = addNode(nodes, "source_collection", source);
      addEdge(edges, sourceNode, endpointNode, "serves");
    }
  }

  for (const tool of tools) {
    const toolNode = addNode(nodes, "mcp_tool", tool.name || "unknown", {
      mode: tool.mode,
      risk_tier: tool.risk_tier,
      provenance_required: tool.provenance_required,
      receipt_required: tool.receipt_required,
    });
    addEdge(edges, toolNode, mcpSurface, "exposed_by");

    if (!tool.name) failures.push("tool_missing_name");
    if (tool.provenance_required !== true) failures.push(`${tool.name}:provenance_not_required`);
    if (tool.receipt_required !== true) failures.push(`${tool.name}:receipt_not_required`);
    if (!Array.isArray(tool.allowed_sources) || tool.allowed_sources.length === 0) failures.push(`${tool.name}:missing_allowed_sources`);
    if (!Array.isArray(tool.allowed_endpoints) || tool.allowed_endpoints.length === 0) failures.push(`${tool.name}:missing_allowed_endpoints`);

    for (const endpoint of tool.allowed_endpoints || []) {
      const endpointNode = addNode(nodes, "endpoint", endpoint);
      addEdge(edges, endpointNode, toolNode, "allowed_for");
    }
    for (const source of tool.allowed_sources || []) {
      const sourceNode = addNode(nodes, "source_collection", source);
      addEdge(edges, sourceNode, toolNode, "allowed_source");
    }
  }

  const endpointNodes = Array.from(nodes.values()).filter((node) => node.type === "endpoint");
  for (const endpoint of endpointNodes) {
    const incoming = edges.some((edge) => edge.to === endpoint.id && ["serves"].includes(edge.relation));
    const allowed = edges.some((edge) => edge.from === endpoint.id && ["allowed_for", "feeds"].includes(edge.relation));
    if (!incoming && !allowed && endpoint.label !== "missing") failures.push(`unconnected_endpoint:${endpoint.label}`);
  }

  const receipt = {
    schema_version: "swfi.lineage_manifest.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      nodes: nodes.size,
      edges: edges.length,
      dashboard_modules: modules.length,
      mcp_tools: tools.length,
      failures: failures.length,
    },
    nodes: Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id)),
    edges,
    failures,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run();
