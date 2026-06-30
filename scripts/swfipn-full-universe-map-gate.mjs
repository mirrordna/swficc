#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const latestReceiptPath = path.join(outputDir, "swfipn-full-universe-map-gate-latest.json");
const statePath = path.join(outputDir, "swfipn-full-universe-map-gate-state.json");

const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/");
const originUrl = new URL(origin);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || originUrl.origin).replace(/\/$/, "");

const pageLimit = clampNumber(process.env.SWFIPN_UNIVERSE_LIMIT, 1, 1000, 100);
const concurrency = clampNumber(process.env.SWFIPN_CONCURRENCY, 1, 50, 10);
const maxPages = clampNumber(process.env.SWFIPN_MAX_PAGES, 0, 1_000_000, 0);
const collectionsToRun = process.env.SWFIPN_COLLECTION ? [process.env.SWFIPN_COLLECTION] : ["entities", "transactions", "people", "compass", "research", "reports"];
const allowPartialExit = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_ALLOW_PARTIAL_EXIT || ""));
const verifyMode = String(process.env.SWFIPN_VERIFY_MODE || "html").toLowerCase();

const forbiddenText = [
  /\bActive Mirror\b/i,
  /\bObject\s*_?ID\b/i,
  /\bMongo(?:DB)?\b/i,
  /\bBackend ID\b/i,
  /\bEndpoint:/i,
  /\bschema_version\b/i,
  /\bsource_gap(?:_reason)?\b/i,
  /\bSource gap\b/i,
  /\bresult_qualifier\b/i,
  /\bsource_doc(?:_id|_ids|_count)?\b/i,
  /\bsource_collection\b/i,
  /\bservice token\b/i,
  /\bSWFIPN_BACKEND\b/i,
  /\bSWFI2_API_TOKEN\b/i,
  /\bNo internal record mapping\b/i,
  /\bcitation-only\b/i,
  /\bplaceholder\b/i,
  /\bundefined\b/i,
  /\bnull\b/i,
  /\b[a-f0-9]{24}\b/i,
];

const families = [
  {
    id: "entities",
    collection: "entities",
    uiRoute: (id) => `/profiles/detail/?id=${id}`,
    detailEndpoint: (id) => `/api/profiles/${encodeURIComponent(id)}/v1`,
    label: (row) => text(row.name || row.title || row.slug || ""),
    sourceFromRow: (row) => text(row.source_url || row.swfi_url || row.url),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "entities") || hexId(row.entity_id || row.id || row.source_record_id),
  },
  {
    id: "people",
    collection: "people",
    uiRoute: (id) => `/people/detail/?id=${id}`,
    detailEndpoint: (id) => `/api/people/${encodeURIComponent(id)}/v1`,
    label: (row) => text(row.name || row.title || ""),
    sourceFromRow: (row) => text(row.source_url || row.swfi_url || row.url),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "people") || hexId(row.person_id || row.id || row.source_record_id),
  },
  {
    id: "transactions",
    collection: "transactions",
    uiRoute: (id) => `/transactions/detail/?id=${id}`,
    detailEndpoint: (id) => `/api/transactions/${encodeURIComponent(id)}/v1`,
    label: (row) => text(row.title || row.name || ""),
    sourceFromRow: (row) => text(row.source_url || row.swfi_url || row.url),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "transactions") || hexId(row.transaction_id || row.id || row.source_record_id),
  },
  {
    id: "compass",
    collection: "compass",
    uiRoute: (id) => `/mandates/detail/?id=${id}`,
    detailEndpoint: (id) => `/api/compass/${encodeURIComponent(id)}/v1`,
    label: (row) => text(row.title || row.name || ""),
    sourceFromRow: (row) => text(row.source_url || row.swfi_url || row.url),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "compass") || hexId(row.compass_id || row.mandate_id || row.rfp_id || row.id || row.source_record_id),
  },
  {
    id: "research",
    collection: "news",
    uiRoute: (id) => `/research/detail/?legacy=${encodeURIComponent(id)}`,
    detailEndpoint: (id) => `/api/source-intelligence/news/detail/v1?legacy_id=${encodeURIComponent(id)}`,
    label: (row) => text(row.title || row.name || ""),
    sourceFromRow: (row) => text(row.source_url || row.swfi_url || row.url) || (numericId(row.legacy_post || row.legacy_post_id) ? `https://www.swfi.com/?p=${numericId(row.legacy_post || row.legacy_post_id)}` : ""),
    idFromRow: (row) => numericId(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id || row.wp_id || idFromLegacyUrl(row.source_url || row.url)),
  },
  {
    id: "reports",
    collection: "reports",
    uiRoute: (id) => `/reports/detail/?key=${encodeURIComponent(id)}`,
    detailEndpoint: (id) => `/api/reports/${encodeURIComponent(id)}/v1`,
    label: (row) => text(row.title || row.name || ""),
    sourceFromRow: (row) => text(row.source_url || row.report_url || row.swfi_url || row.url),
    idFromRow: (row) => text(row.report_key || row.report_id || row.id || row.source_record_id) || reportKeyFromUrl(row.source_url || row.report_url || row.url),
  }
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function text(value) {
  return String(value ?? "").trim();
}

function hexId(value) {
  const match = text(value).match(/^[a-f0-9]{24}$/i);
  return match ? match[0].toLowerCase() : "";
}

function numericId(value) {
  const match = text(value).match(/^\d+$/);
  return match ? match[0] : "";
}

function idFromLegacyUrl(value) {
  try {
    const parsed = new URL(text(value));
    return numericId(parsed.searchParams.get("p"));
  } catch {
    return "";
  }
}

function reportKeyFromUrl(value) {
  try {
    const parsed = new URL(text(value));
    const match = parsed.pathname.match(/\/reports\/([^/?#]+)\.pdf$/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function idFromSwfiSource(value, expectedSection) {
  try {
    const parsed = new URL(text(value));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(String(parsed.hostname || "").toLowerCase())) return "";
    const match = parsed.pathname.match(/^\/v1\/(entities|people|transactions|compass)\/([a-f0-9]{24})\/?$/i);
    if (!match) return "";
    if (match[1].toLowerCase() !== expectedSection) return "";
    return match[2].toLowerCase();
  } catch {
    return "";
  }
}

function appUrl(route) {
  const value = String(route || "/");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/swficc/")) return new URL(value, originUrl.origin).href;
  if (value.startsWith("/")) return new URL(value.replace(/^\//, ""), origin).href;
  return new URL(value, origin).href;
}

function scanUrl(collection, limit, after) {
  const params = new URLSearchParams({ collection, limit: String(limit) });
  if (after) params.set("after", after);
  return `${backendOrigin}/api/source-data/scan/v1?${params.toString()}`;
}

function detailUrl(family, id) {
  if (!family.detailEndpoint) return "";
  return `${backendOrigin}${family.detailEndpoint(id)}`;
}

async function fetchJson(url, timeoutMs = 45_000, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "SWFIPN-FullUniverseMapGate/1.0",
        },
      });
      const textBody = await response.text();
      let body;
      try {
        body = JSON.parse(textBody);
      } catch {
        body = { raw: textBody.slice(0, 500) };
      }
      if (response.status >= 500 || response.status === 429) {
        if (attempt === maxRetries) return { status: response.status, body };
        console.warn(`[fetchJson] HTTP ${response.status}, retrying in ${5000 * attempt}ms...`);
        await new Promise(r => setTimeout(r, 5000 * attempt));
        continue;
      }
      return { status: response.status, body };
    } catch (err) {
      if (attempt === maxRetries) {
        return { status: 500, body: { error: err.message } };
      }
      console.warn(`[fetchJson] Attempt ${attempt} failed, retrying in ${5000 * attempt}ms...`);
      await new Promise(r => setTimeout(r, 5000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchHtml(url, timeoutMs = 30_000, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml",
          "User-Agent": "SWFIPN-FullUniverseMapGate/1.0",
        },
      });
      const textBody = await response.text();
      if (response.status >= 500 || response.status === 429) {
        if (attempt === maxRetries) return { status: response.status, text: textBody, url: response.url };
        console.warn(`[fetchHtml] HTTP ${response.status}, retrying in ${5000 * attempt}ms...`);
        await new Promise(r => setTimeout(r, 5000 * attempt));
        continue;
      }
      return { status: response.status, text: textBody, url: response.url };
    } catch (err) {
      if (attempt === maxRetries) {
        return { status: 500, text: "", url, error: err.message };
      }
      console.warn(`[fetchHtml] Attempt ${attempt} failed, retrying in ${5000 * attempt}ms...`);
      await new Promise(r => setTimeout(r, 5000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function packetRows(packet) {
  const data = packet?.data || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function packetRecord(packet) {
  const data = packet?.data || {};
  return data.profile || data.record || packetRows(packet)[0] || {};
}

function isFactPacket(packet) {
  return packet?.status === "ok" && packet?.fact === true;
}

async function verifyDetailRecord(family, id, expectedLabel) {
  const url = detailUrl(family, id);
  if (!url) return { ok: false, reason: "detail_endpoint_missing" };
  const fetched = await fetchJson(url);
  if (fetched.status !== 200) return { ok: false, reason: `detail_http_${fetched.status}`, url };
  if (!isFactPacket(fetched.body)) return { ok: false, reason: `detail_not_fact:${text(fetched.body?.status || fetched.body?.unavailable_reason || fetched.body?.source_gap_reason || "missing")}`, url };
  const record = packetRecord(fetched.body);
  const detailLabel = text(record.name || record.title || record.legal_name, "");
  const expected = text(expectedLabel, "").toLowerCase();
  const actual = detailLabel.toLowerCase();
  if (expected && actual && (actual.includes(expected) || expected.includes(actual))) return { ok: true, url, detailLabel };
  return { ok: false, reason: `detail_label_mismatch:${expectedLabel}->${detailLabel || "missing"}`, url };
}

function stripHtml(html) {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
             .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

function loadState() {
  if (process.env.SWFIPN_RESET_STATE === "1") return emptyState();
  if (fs.existsSync(statePath)) {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf-8')));
    } catch {}
  }
  return emptyState();
}

function normalizeState(state) {
  const base = emptyState();
  return {
    collections: { ...base.collections, ...(state?.collections || {}) },
    failures: Array.isArray(state?.failures) ? state.failures : [],
    quarantine: Array.isArray(state?.quarantine) ? state.quarantine : []
  };
}

function emptyState() {
  return { 
    collections: {
      entities: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" },
      people: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" },
      transactions: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" },
      compass: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" },
      research: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" },
      reports: { total: 0, mapped: 0, rendered: 0, failed: 0, quarantined: 0, after: "" }
    },
    failures: [],
    quarantine: []
  };
}

function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const state = loadState();

  const receipt = {
    status: "fail",
    generated_at: new Date().toISOString(),
    verification_mode: verifyMode,
    partial_run: Boolean(maxPages || process.env.SWFIPN_COLLECTION),
    partial_reason: maxPages ? `max_pages_${maxPages}` : process.env.SWFIPN_COLLECTION ? `single_collection_${process.env.SWFIPN_COLLECTION}` : "",
    collections: state.collections,
    failures: state.failures,
    quarantine: state.quarantine
  };

  for (const familyId of collectionsToRun) {
    const family = families.find((f) => f.id === familyId);
    if (!family) continue;

    console.log(`\n--- Starting collection: ${family.id} ---`);
    let after = state.collections[family.id].after;
    let keepScanning = true;
    let pages = 0;

    while (keepScanning) {
      pages += 1;
      console.log(`[${family.id}] Fetching batch, after=${after}`);
      const packet = await fetchJson(scanUrl(family.collection, pageLimit, after));
      
      if (packet.status >= 400 || packet.body?.status !== "ok") {
        console.error(`Failed to fetch backend rows: ${packet.status}`);
        break;
      }

      const rows = packet.body?.data?.rows || packet.body?.data?.results || [];
      if (rows.length === 0) {
        keepScanning = false;
        break;
      }

      state.collections[family.id].total += rows.length;

      // Process in batches according to concurrency
      for (let i = 0; i < rows.length; i += concurrency) {
        const batch = rows.slice(i, i + concurrency);
        
        await Promise.all(batch.map(async (row) => {
          const id = family.idFromRow(row);
          const label = family.label(row);
          const sourceUrl = family.sourceFromRow ? family.sourceFromRow(row) : text(row.source_url || row.swfi_url || row.url);
          
          if (!id || !sourceUrl || !label) {
            state.collections[family.id].quarantined += 1;
            state.quarantine.push({
              collection: family.id,
              id: id || "unknown",
              reason: !id ? "missing source url / unreadable source" : "missing required business label"
            });
            return;
          }

          state.collections[family.id].mapped += 1;

          const localRoute = family.uiRoute(id);
          const fullLocalUrl = appUrl(localRoute);

          if (verifyMode === "api") {
            const detailCheck = await verifyDetailRecord(family, id, label);
            if (detailCheck.ok) {
              state.collections[family.id].rendered += 1;
            } else {
              state.collections[family.id].failed += 1;
              state.failures.push({
                collection: family.id,
                id,
                source_url: sourceUrl,
                expected_route: localRoute,
                actual_route: detailCheck.url || detailUrl(family, id),
                reason: detailCheck.reason || "api_detail_failed",
                evidence: detailCheck.detailLabel || ""
              });
            }
            return;
          }
          
          const htmlRes = await fetchHtml(fullLocalUrl);
          
          if (htmlRes.status !== 200) {
            state.collections[family.id].failed += 1;
            state.failures.push({
              collection: family.id,
              id,
              source_url: sourceUrl,
              expected_route: localRoute,
              actual_route: htmlRes.url,
              reason: `HTTP ${htmlRes.status}`,
              evidence: htmlRes.error || "No HTML"
            });
            return;
          }

          const plainText = stripHtml(htmlRes.text);
          let failureReason = null;
          
          // 3. Verify business identity
          const searchLabel = label.length > 20 ? label.slice(0, 20) : label;
          if (!plainText.toLowerCase().includes(searchLabel.toLowerCase())) {
            const detailCheck = await verifyDetailRecord(family, id, label);
            if (!detailCheck.ok) {
              failureReason = `Label "${searchLabel}" not found in page text; ${detailCheck.reason}`;
            }
          }

          // 4. No route redirects to swfi.com
          if (!failureReason && htmlRes.text.includes("href=\"https://www.swfi.com/v1/")) {
             const hasSwfiRecordLink = /href=["']https?:\/\/(www\.)?swfi\.com\/v1\/(entities|people|transactions|compass)/i.test(htmlRes.text);
             if (hasSwfiRecordLink) {
                 failureReason = "Found external SWFI.com record links in HTML";
             }
          }

          // 5. No visible internal leakage
          if (!failureReason) {
            for (const pattern of forbiddenText) {
              if (pattern.test(plainText)) {
                // Ensure the hex pattern doesn't false-positive on valid attributes unless it's visible text. 
                // Because we stripped HTML tags, anything matching here is in the text nodes or inline scripts.
                // Note: since Next.js inlines JSON state, this will catch hex IDs in the state. 
                // The requirements say "visible internal leakage: object IDs as labels". 
                // If we use regex on the raw plainText (which includes inline JSON), it might false positive.
                // Let's refine the plainText to remove script data. We already removed <script> tags.
                // Wait, React Next.js puts state in a script tag id="__NEXT_DATA__". `stripHtml` removes `<script>...` so it's fine.
                if (pattern.source === "\\b[a-f0-9]{24}\\b") {
                  // Only fail if it's the exact same hex ID that is leaked as a label, or any hex id?
                  // For now, any visible hex ID fails.
                }
                failureReason = `Leakage detected: ${pattern.source}`;
                break;
              }
            }
          }

          if (failureReason) {
            state.collections[family.id].failed += 1;
            state.failures.push({
              collection: family.id,
              id,
              source_url: sourceUrl,
              expected_route: localRoute,
              actual_route: htmlRes.url,
              reason: failureReason,
              evidence: plainText.slice(0, 300) + "..."
            });
          } else {
            state.collections[family.id].rendered += 1;
          }
        }));
      }

      const nextAfter = packet.body?.data?.next_after;
      if ((maxPages && pages >= maxPages) || !nextAfter || String(nextAfter) === String(after) || !packet.body?.data?.has_more) {
        keepScanning = false;
      } else {
        after = String(nextAfter);
        state.collections[family.id].after = after;
      }
      saveState(state);
      
      console.log(`[${family.id}] Checkpoint: total=${state.collections[family.id].total}, rendered=${state.collections[family.id].rendered}, failed=${state.collections[family.id].failed}`);
    }
  }

  const allPassed = state.failures.length === 0;
  if (allPassed) {
    if (receipt.partial_run) {
      receipt.status = "partial_pass";
    } else if (state.quarantine.length > 0) {
      receipt.status = "pass_with_quarantine";
    } else {
      receipt.status = "pass";
    }
  } else {
    receipt.status = "fail";
  }

  receipt.generated_at = new Date().toISOString();
  
  const cleanCollections = JSON.parse(JSON.stringify(state.collections));
  for (const k of Object.keys(cleanCollections)) {
    delete cleanCollections[k].after;
  }
  receipt.collections = cleanCollections;

  fs.writeFileSync(latestReceiptPath, JSON.stringify(receipt, null, 2));
  console.log(`\nFinal Receipt written to ${latestReceiptPath}`);
  console.log(JSON.stringify({
    status: receipt.status,
    totals: Object.fromEntries(Object.entries(receipt.collections).map(([k, v]) => [k, {total: v.total, failed: v.failed}]))
  }, null, 2));

  if (receipt.status === "fail" || (receipt.status === "partial_pass" && !allowPartialExit)) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
