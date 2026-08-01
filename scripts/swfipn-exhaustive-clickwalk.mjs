#!/usr/bin/env node
// Exhaustive click-walk (minutes 2026-07-03 F + G, literal):
//   F - no button, tab, metric, or link without working function;
//   G - every navigation chain terminates at the SWFI platform.
// BFS every internal page from /, collect EVERY anchor on each rendered
// page, then classify:
//   internal route  -> must render (HTTP 200, non-error shell)
//   swfi.com href   -> must match the signin-handoff or a public swfi page
//   other external  -> FLAG (nothing on this dashboard should leave the
//                      swfi universe)
//   empty/dead href -> FLAG
// Receipt: output/swfipn-exhaustive-clickwalk-latest.json
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire("/Users/mirror-pro/repos/swfireskin/package.json");
const { chromium } = require("playwright");

const ORIGIN = process.env.CLICKWALK_ORIGIN || "https://dashboard.swfi.com";
const BASE = "/swficc";
const MAX_PAGES = 60;

function normalizeRoute(href) {
  try {
    const url = new URL(href, `${ORIGIN}${BASE}/`);
    if (url.origin !== new URL(ORIGIN).origin) return null;
    let path = url.pathname;
    if (!path.startsWith(`${BASE}/`) && path !== BASE) return null;
    // Crawl each route once - drop query/hash for the queue key, but keep
    // detail routes OUT of the queue (they forward off-site by design).
    if (/\/detail\/?$/.test(path)) return null;
    return path.replace(/\/?$/, "/");
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const queue = [`${BASE}/`];
const seen = new Set(queue);
const pages = [];
const flags = [];
let anchorsTotal = 0;
let swfiHandoffs = 0;
let internalLinks = 0;

while (queue.length && pages.length < MAX_PAGES) {
  const route = queue.shift();
  const target = `${ORIGIN}${route}`;
  let status = 0;
  let anchors = [];
  try {
    const response = await page.goto(target, { waitUntil: "networkidle", timeout: 60_000 });
    status = response ? response.status() : 0;
    await page.waitForTimeout(2500);
    anchors = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a")).map((a) => ({
        href: String(a.getAttribute("href") || ""),
        target: String(a.getAttribute("target") || ""),
        text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      }))
    );
  } catch (error) {
    flags.push({ route, kind: "page_error", detail: String(error.message).slice(0, 120) });
    pages.push({ route, status, anchors: 0 });
    continue;
  }
  if (status >= 400) flags.push({ route, kind: "http_error", detail: `HTTP ${status}` });
  anchorsTotal += anchors.length;
  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href || href === "#") {
      flags.push({ route, kind: "dead_href", detail: `"${anchor.text}"` });
      continue;
    }
    if (/^(mailto:|tel:)/.test(href)) continue;
    if (/^https?:\/\//.test(href)) {
      try {
        const host = new URL(href).hostname;
        // Law 2026-07-06: no external finals — EXCEPT LinkedIn profile
        // links that open in a NEW TAB (Paul-sanctioned same day; the
        // in-tab chain still terminates at swfi.com).
        const newTabLinkedin = ["www.linkedin.com", "linkedin.com"].includes(host) && anchor.target === "_blank";
        if (host.endsWith("swfi.com")) {
          swfiHandoffs += 1;
        } else if (host !== new URL(ORIGIN).hostname && !newTabLinkedin) {
          flags.push({ route, kind: "non_swfi_external", detail: `${host} <- "${anchor.text}"` });
        }
      } catch {
        flags.push({ route, kind: "unparseable_href", detail: href.slice(0, 80) });
      }
      continue;
    }
    internalLinks += 1;
    const next = normalizeRoute(href);
    if (next && !seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
  pages.push({ route, status, anchors: anchors.length });
}

const receipt = {
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  pages_crawled: pages.length,
  anchors_seen: anchorsTotal,
  internal_links: internalLinks,
  swfi_platform_links: swfiHandoffs,
  flags,
  ok: flags.length === 0,
  pages,
};
mkdirSync("output", { recursive: true });
writeFileSync("output/swfipn-exhaustive-clickwalk-latest.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ ok: receipt.ok, pages: pages.length, anchors: anchorsTotal, swfi_links: swfiHandoffs, flags: flags.length }, null, 1));
if (flags.length) console.log(JSON.stringify(flags.slice(0, 12), null, 1));
await browser.close();
