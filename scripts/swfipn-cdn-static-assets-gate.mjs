#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const receiptPath = path.join(outputDir, "swfipn-cdn-static-assets-gate-latest.json");

const failures = [];
const checks = [];

const html = await request(origin);
checks.push({
  id: "html_served_by_cloudflare",
  ok: headerIncludes(html.headers, "server", "cloudflare"),
  evidence: publicHeaders(html.headers, ["server", "cf-cache-status", "cache-control", "via"]),
});
checks.push({
  id: "html_shell_has_short_revalidation_cache",
  ok: htmlShellCachePolicyOk(html.headers["cache-control"]),
  evidence: publicHeaders(html.headers, ["cache-control", "cf-cache-status"]),
});

const assets = [...new Set((html.body.match(/\/swficc\/_next\/static\/[^"'\s<>\\]+/g) || []))]
  .filter((asset) => /\.(?:js|css)(?:\?|$)/.test(asset))
  .slice(0, Number(process.env.SWFIPN_CDN_ASSET_SAMPLE || 5));
checks.push({
  id: "versioned_next_static_assets_present",
  ok: assets.length > 0 && assets.every((asset) => asset.includes("?v=")),
  evidence: { sampled_assets: assets },
});

const assetChecks = [];
for (const asset of assets) {
  const url = new URL(asset, origin).href;
  const head = await request(url, "HEAD");
  const cacheControl = String(head.headers["cache-control"] || "");
  const cfCacheStatus = String(head.headers["cf-cache-status"] || "");
  const ok = head.statusCode === 200
    && headerIncludes(head.headers, "server", "cloudflare")
    && /public/i.test(cacheControl)
    && /max-age=31536000|immutable/i.test(cacheControl)
    && /HIT|MISS|EXPIRED|REVALIDATED|STALE/i.test(cfCacheStatus);
  assetChecks.push({
    url,
    ok,
    status: head.statusCode,
    evidence: publicHeaders(head.headers, [
      "server",
      "cf-cache-status",
      "cache-control",
      "age",
      "last-modified",
      "via",
    ]),
  });
}
checks.push({
  id: "sampled_static_assets_have_cdn_cache_policy",
  ok: assetChecks.length > 0 && assetChecks.every((check) => check.ok),
  evidence: { asset_checks: assetChecks },
});

for (const check of checks) {
  if (!check.ok) failures.push(check.id);
}

const receipt = {
  schema_version: "swfipn.cdn_static_assets_gate.v1",
  generated_at: new Date().toISOString(),
  origin,
  status: failures.length ? "fail" : "pass",
  no_secret_values_written: true,
  summary: {
    checks: checks.length,
    failures: failures.length,
    sampled_assets: assets.length,
  },
  checks,
  failures,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, summary: receipt.summary }, null, 2));
if (failures.length) process.exit(1);

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function headerIncludes(headers, name, needle) {
  return String(headers[name] || "").toLowerCase().includes(needle.toLowerCase());
}

function publicHeaders(headers, names) {
  return Object.fromEntries(names.map((name) => [name, headers[name] || null]));
}

function htmlShellCachePolicyOk(value) {
  const cacheControl = String(value || "");
  if (/no-store|no-cache|max-age=0/i.test(cacheControl)) return true;
  const maxAge = Number((cacheControl.match(/(?:^|,\s*)max-age=(\d+)/i) || [])[1] || NaN);
  const sharedMaxAge = Number((cacheControl.match(/(?:^|,\s*)s-maxage=(\d+)/i) || [])[1] || NaN);
  return /public/i.test(cacheControl)
    && Number.isFinite(maxAge)
    && Number.isFinite(sharedMaxAge)
    && maxAge <= 60
    && sharedMaxAge <= 300
    && /stale-while-revalidate=/i.test(cacheControl);
}

function request(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { "user-agent": "SWFIPN-CDN-Gate/1.0" },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
    req.end();
  });
}
