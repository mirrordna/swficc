#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const outputPath = path.join(repoRoot, "src", "lib", "homeSourceSnapshot.ts");
const origin = normalizeOrigin(process.env.SWFIPN_BACKEND_ORIGIN || process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");

const endpoints = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  institutionTypes: "/api/institution-types/v1?limit=8",
  allocators30: "/api/allocator-activity/v1?days=30&limit=25&page=1&sort=deal_count&direction=desc",
  allocators90: "/api/allocator-activity/v1?days=90&limit=1&count_only=1",
  rfps: "/api/live-opportunities/v1?limit=25&page=1",
  mandates: "/api/live-mandates/v1?limit=25&page=1",
  transactions30: "/api/recent-transactions/v1?days=30&limit=50&page=1",
  entities: "/api/source-data/search/v1?collection=entities&limit=25&page=1",
  people: "/api/source-data/search/v1?collection=people&limit=25&page=1",
  top20: "/v1/swfi/top20?limit=25",
  news: "/api/source-intelligence/news/v1?limit=25",
  sectorFlows: "/api/sector-flows/v1?days=365",
};

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function apiUrl(route) {
  const root = new URL(origin);
  return new URL(route, root.origin).href;
}

function isFactPacket(packet) {
  const status = String(packet?.status || "").toLowerCase();
  const state = String(packet?.state || "").toLowerCase();
  const qualifier = String(packet?.result_qualifier || "").toLowerCase();
  if (packet?.fact === true && status === "ok") return true;
  return status === "ok" && state === "vault" && qualifier === "fact" && !packet?.source_gap;
}

async function fetchPacket(key, route) {
  const response = await fetch(apiUrl(route), {
    headers: { Accept: "application/json", "X-SWFIPN-Public": "1" },
  });
  if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
  const packet = await response.json();
  if (!isFactPacket(packet)) throw new Error(`${key}: non-fact packet`);
  return packet;
}

const settledEntries = await Promise.all(
  Object.entries(endpoints).map(async ([key, route]) => {
    try {
      return { key, packet: await fetchPacket(key, route) };
    } catch (error) {
      return { key, error: String(error?.message || error) };
    }
  }),
);
const entries = settledEntries
  .filter((entry) => entry.packet)
  .map((entry) => [entry.key, entry.packet]);
const skipped = settledEntries
  .filter((entry) => !entry.packet)
  .map((entry) => ({ key: entry.key, reason: entry.error }));
if (skipped.length) {
  throw new Error(`Incomplete home snapshot: ${skipped.map((entry) => `${entry.key}=${entry.reason}`).join(", ")}`);
}
const snapshot = Object.fromEntries(entries);
const body = `import type { Packet } from "@/lib/sourcePackets";

// Captured from the SWFIPN public backend fact packets for fast first paint.
// Regenerate before deploy; live packets replace these values after hydration.
export const HOME_PACKET_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)} satisfies Record<string, Packet>;
`;

await fs.writeFile(outputPath, body);
console.log(JSON.stringify({
  status: "ok",
  output: outputPath,
  origin,
  packets: Object.fromEntries(entries.map(([key, packet]) => [key, packet.generated_at || ""])),
  skipped,
}, null, 2));
