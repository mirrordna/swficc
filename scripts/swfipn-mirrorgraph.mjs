import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "output");

const mappings = [
  {
    id: "swfi_entity_detail",
    sourcePattern: "https://www.swfi.com/v1/entities/{id}",
    internalRoute: "/swficc/profiles/detail/?id={id}&source={source_url}",
    backendEndpoint: "/api/profiles/{id}/v1",
    upstreamPath: "/v1/api/entities/{id} + /v1/api/entities/{id}/aum",
    modules: ["overview", "assets", "people", "strategy", "transactions", "compass", "documents", "holdings", "benchmarks", "contact"],
    status: "live",
    failureState: "source_gap per module",
  },
  {
    id: "swfi_transaction_detail",
    sourcePattern: "https://www.swfi.com/v1/transactions/{id}",
    internalRoute: "/swficc/transactions/detail/?id={id}&source={source_url}",
    backendEndpoint: "/api/transactions/{id}/v1",
    upstreamPath: "/v1/api/transactions/{id}",
    modules: ["source page data", "buyer entities", "seller entities", "amount", "dates", "source record"],
    status: "live",
    failureState: "source_gap when exact transaction id is not in the production mirror",
  },
  {
    id: "swfi_compass_detail",
    sourcePattern: "https://www.swfi.com/v1/compass/{id}",
    internalRoute: "/swficc/mandates/detail/?id={id}&source={source_url}",
    backendEndpoint: "/api/compass/{id}/v1",
    upstreamPath: "/v1/api/compass/{id}",
    modules: ["source page data", "institution", "summary", "amount", "dates", "source record"],
    status: "live",
    failureState: "source_gap when exact Compass id is not in the production mirror",
  },
  {
    id: "swfi_people_detail",
    sourcePattern: "https://www.swfi.com/v1/people/{id}",
    internalRoute: "/swficc/people/detail/?id={id}&source={source_url}",
    backendEndpoint: "/api/people/{id}/v1",
    upstreamPath: "/v1/api/people/{id}",
    modules: ["source page data", "contact fields", "geography", "source record"],
    status: "live_after_backend_reload",
    failureState: "source_gap when exact people id is not in the production mirror",
  },
  {
    id: "swfi_reports_documents",
    sourcePattern: "https://www.swfi.com/v1/{reports|documents|filings}/{id}",
    internalRoute: "/swficc/research/?source={source_url}",
    backendEndpoint: "/api/reports/quarterly/v1",
    upstreamPath: "pending verified SWFI reports/filings endpoint",
    modules: ["citation", "source_gap"],
    status: "blocked_pending_contract",
    failureState: "source_gap",
  },
];

const nodes = [];
const edges = [];

function addNode(id, type, label, extra = {}) {
  nodes.push({ id, type, label, ...extra });
}

function addEdge(source, target, label) {
  edges.push({ source, target, label });
}

addNode("doctrine", "doctrine", "SWFI source URL mirror doctrine", {
  rule: "Every SWFI source URL maps to an internal SWFIPN route or explicit source_gap.",
});

for (const item of mappings) {
  const sourceId = `source:${item.id}`;
  const routeId = `route:${item.id}`;
  const backendId = `backend:${item.id}`;
  const upstreamId = `upstream:${item.id}`;
  const moduleId = `modules:${item.id}`;
  addNode(sourceId, "source_url_pattern", item.sourcePattern, { status: item.status });
  addNode(routeId, "frontend_route", item.internalRoute, { failure_state: item.failureState });
  addNode(backendId, "backend_endpoint", item.backendEndpoint, { status: item.status });
  addNode(upstreamId, "upstream_path", item.upstreamPath);
  addNode(moduleId, "ui_modules", item.modules.join(", "), { modules: item.modules });
  addEdge("doctrine", sourceId, "governs");
  addEdge(sourceId, routeId, "maps to internal route");
  addEdge(routeId, backendId, "fetches");
  addEdge(upstreamId, backendId, "feeds");
  addEdge(backendId, moduleId, "renders");
}

const graph = {
  schema_version: "swfipn.route_mirrorgraph.v1",
  generated_at: new Date().toISOString(),
  status: "pass",
  mappings,
  nodes,
  edges,
};

function mermaid(g) {
  const labels = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
  const lines = ["flowchart LR"];
  for (const edge of g.edges) {
    const source = `${edge.source}\\n${labels[edge.source] || edge.source}`.replaceAll('"', "'");
    const target = `${edge.target}\\n${labels[edge.target] || edge.target}`.replaceAll('"', "'");
    lines.push(`  "${source}" -- "${edge.label}" --> "${target}"`);
  }
  return `${lines.join("\n")}\n`;
}

fs.mkdirSync(OUT, { recursive: true });
const jsonOutput = path.join(OUT, "swfipn-route-mirrorgraph-latest.json");
const mermaidOutput = path.join(OUT, "swfipn-route-mirrorgraph-latest.mmd");
fs.writeFileSync(jsonOutput, `${JSON.stringify(graph, null, 2)}\n`);
fs.writeFileSync(mermaidOutput, mermaid(graph));
console.log(JSON.stringify({ status: graph.status, mappings: mappings.length, json_output: jsonOutput, mermaid_output: mermaidOutput }, null, 2));
