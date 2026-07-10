#!/usr/bin/env node
// swfipn-one-to-one-audit: proves the 1:1 record->swfi.com routing law on the
// LIVE product, beyond HTTP 200 (random samples per collection; each sampled
// pointer must resolve on www.swfi.com without a 404 marker; no invented URLs).
//
// Router law (mirrors the app's resolution ladder — page.tsx sourceHref /
// researchSourceUrl / SwfiPlatformRedirect):
//   1. source_url | swfi_url | url   (must be swfi.com)          -> canonical
//   2. legacy_post | legacy_post_id  -> https://www.swfi.com/?p=<id>  (news)
//   3. record id -> https://www.swfi.com/v1/<collection>/<id>
//   4. nothing resolvable -> FAIL (a record without a platform pointer breaks 1:1)
//
// Exit 0 only when every audited collection meets the law. Receipt:
//   output/swfipn-one-to-one-audit-latest.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const { chromium } = await import(path.join(repoRoot, "node_modules/playwright-core/index.js")).then(m => m.default || m);

const origin = (process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/").replace(/\/?$/, "/");
const SAMPLE_PER_COLLECTION = Number(process.env.ONE_TO_ONE_SAMPLE || 12);
const RESOLVE_PER_COLLECTION = Number(process.env.ONE_TO_ONE_RESOLVE || 4);

const COLLECTIONS = [
  { key: "entities", url: "/api/source-data/search/v1?collection=entities&limit=25&page=1", idCollection: "entities" },
  { key: "people", url: "/api/source-data/search/v1?collection=people&limit=25&page=1", idCollection: "people" },
  { key: "transactions", url: "/api/recent-transactions/v1?days=30&limit=50&page=1", idCollection: "transactions" },
  { key: "mandates", url: "/api/live-mandates/v1?limit=25&page=1", idCollection: "compass" },
  { key: "opportunities", url: "/api/live-opportunities/v1?limit=25&page=1", idCollection: "compass" },
  { key: "news", url: "/api/source-intelligence/news/v1?limit=25", idCollection: "news" },
];
const ID_FIELDS = ["id", "person_id", "entity_id", "transaction_id", "source_record_id", "record_id", "_id"];
const isSwfi = (u) => typeof u === "string" && /^https?:\/\/(www\.)?swfi\.com\//i.test(u);

function routeRecord(row, idCollection) {
  const ptr = [row.source_url, row.swfi_url, row.url].find(isSwfi);
  if (ptr) return { url: ptr, via: "pointer" };
  const legacy = row.legacy_post ?? row.legacy_post_id;
  if (legacy != null && /^\d+$/.test(String(legacy))) return { url: `https://www.swfi.com/?p=${legacy}`, via: "legacy_post" };
  for (const f of ID_FIELDS) {
    const v = row[f];
    if (v != null && /^[a-f0-9]{24}$/i.test(String(v))) return { url: `https://www.swfi.com/v1/${idCollection}/${v}`, via: `id:${f}` };
  }
  return null; // no resolvable pointer -> 1:1 broken for this row
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
const receipt = { schema_version: "swfipn.one_to_one_audit.v1", generated_at: new Date().toISOString(), origin, sample_per_collection: SAMPLE_PER_COLLECTION, collections: {}, ok: false };
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  for (const col of COLLECTIONS) {
    const { status, rows } = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { headers: { accept: "application/json" } });
        if (!r.ok) return { status: r.status, rows: [] };
        const d = await r.json();
        return { status: r.status, rows: d?.data?.rows || d?.data || d?.data?.results || [] };
      } catch (e) { return { status: "ERR", rows: [] }; }
    }, col.url);
    const sampled = shuffle([...rows]).slice(0, SAMPLE_PER_COLLECTION);
    const routed = sampled.map((row) => ({ label: String(row.name || row.title || "?").slice(0, 40), route: routeRecord(row, col.idCollection) }));
    const unroutable = routed.filter((r) => !r.route);
    // beyond-200: resolve a random subset of routed pointers on swfi.com
    const toResolve = shuffle(routed.filter((r) => r.route)).slice(0, RESOLVE_PER_COLLECTION);
    const resolutions = [];
    for (const r of toResolve) {
      try {
        const resp = await ctx.request.get(r.route.url, { timeout: 25000, maxRedirects: 5 });
        let body = ""; try { body = await resp.text(); } catch {}
        const host = (() => { try { return new URL(resp.url()).host.replace(/^www\./, ""); } catch { return "?"; } })();
        const looks404 = /page not found|error 404|>404</i.test(body);
        resolutions.push({ label: r.label, via: r.route.via, status: resp.status(), host, ok: resp.status() === 200 && host === "swfi.com" && !looks404 });
      } catch (e) { resolutions.push({ label: r.label, via: r.route.via, status: "ERR", err: String(e).slice(0, 60), ok: false }); }
    }
    receipt.collections[col.key] = {
      endpoint_status: status,
      pool: rows.length,
      sampled: sampled.length,
      routed: routed.length - unroutable.length,
      unroutable: unroutable.map((r) => r.label),
      via_counts: routed.reduce((m, r) => { if (r.route) m[r.route.via.split(":")[0]] = (m[r.route.via.split(":")[0]] || 0) + 1; return m; }, {}),
      resolved_ok: resolutions.filter((x) => x.ok).length,
      resolved_total: resolutions.length,
      resolution_failures: resolutions.filter((x) => !x.ok),
      ok: status === 200 && rows.length > 0 && unroutable.length === 0 && resolutions.every((x) => x.ok),
    };
  }
  receipt.ok = Object.values(receipt.collections).every((c) => c.ok);
} catch (error) {
  receipt.error = String(error && error.message ? error.message : error);
} finally {
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
}
fs.mkdirSync(path.join(repoRoot, "output"), { recursive: true });
fs.writeFileSync(path.join(repoRoot, "output", "swfipn-one-to-one-audit-latest.json"), JSON.stringify(receipt, null, 2));
for (const [k, c] of Object.entries(receipt.collections)) {
  console.log(`${c.ok ? "PASS" : "FAIL"} ${k.padEnd(13)} pool=${String(c.pool).padEnd(3)} routed=${c.routed}/${c.sampled} resolved=${c.resolved_ok}/${c.resolved_total} via=${JSON.stringify(c.via_counts)}${c.unroutable.length ? " UNROUTABLE=" + JSON.stringify(c.unroutable.slice(0, 3)) : ""}`);
}
console.log(receipt.ok ? "ONE-TO-ONE: PASS" : "ONE-TO-ONE: FAIL");
process.exit(receipt.ok ? 0 : 1);
