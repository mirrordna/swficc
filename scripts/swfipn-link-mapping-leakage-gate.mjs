#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-link-mapping-leakage-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/");
const originUrl = new URL(origin);
const basePath = originUrl.pathname.replace(/\/$/, "");

const routes = envList("SWFIPN_MAPPING_LEAKAGE_ROUTES", [
  "/",
  "/profiles/",
  "/profiles/?filter=GC1%20Ventures",
  "/about-us/overview/",
  "/about-us/our-team/",
  "/people/",
  "/transactions/",
  "/deals/",
  "/allocators/",
  "/mandates/",
  "/comparisons/",
  "/reports/",
  "/intelligence/",
  "/research/",
  "/search/?q=Real%20Estate",
  "/about/",
  "/solutions/",
  "/demo/",
  "/contact/",
  "/newsletter-subscription/",
  "/privacy-policy/",
  "/terms-of-use/",
  "/cookie-policy/",
  "/accessibility/",
  "/provenance/",
  "/source/",
]);

const routeExpectations = {
  "/": { entities: 5, transactions: 1, compass: 1 },
  "/profiles/": { entities: 5 },
  "/profiles/?filter=GC1%20Ventures": {
    entities: 1,
    exact: [{ text: /GC1 Ventures/i, redirect: "/v1/entities/5e39a581fcbe7e8ca723278c" }],
  },
  "/people/": { people: 5 },
  "/transactions/": { transactions: 5 },
  "/deals/": { transactions: 5 },
  "/allocators/": { entities: 5 },
  "/mandates/": { compass: 3 },
  "/comparisons/": { entities: 2 },
  "/intelligence/": { research: 5 },
  "/research/": { research: 5 },
  "/search/?q=Real%20Estate": { entities: 1 },
};

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
  /https?:\/\/\S+/i,
  /\b[a-f0-9]{24}\b/i,
];

// Law tightened 2026-07-06 (Paul: "all final links on every page MUST
// redirect to swfi.com"): NO external hosts are approved finals.
const allowedExternalHosts = new Set([]);

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function envList(name, fallback) {
  const parsed = String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function canonicalRecordKindFromPath(pathname) {
  if (/^\/v1\/entities\/[a-f0-9]{24}\/?$/i.test(pathname)) return "entities";
  if (/^\/v1\/people\/[a-f0-9]{24}\/?$/i.test(pathname)) return "people";
  if (/^\/v1\/transactions\/[a-f0-9]{24}\/?$/i.test(pathname)) return "transactions";
  if (/^\/v1\/compass\/[a-f0-9]{24}\/?$/i.test(pathname)) return "compass";
  return "";
}

function parseSwfiSignin(href) {
  try {
    const parsed = new URL(String(href || ""), origin);
    if (parsed.hostname !== "www.swfi.com") return null;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return null;
    if (parsed.searchParams.get("msg") !== "auth") return null;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect || !redirect.startsWith("/") || /^https?:\/\//i.test(redirect)) {
      return {
        href: parsed.href,
        redirect,
        redirectPath: "",
        kind: "",
        absoluteRedirect: /^https?:\/\//i.test(redirect),
        invalidRedirect: true,
      };
    }
    const redirectPath = redirect.startsWith("/")
      ? redirect
      : (() => {
          try {
            const target = new URL(redirect);
            return `${target.pathname}${target.search}${target.hash}`;
          } catch {
            return redirect;
          }
        })();
    return {
      href: parsed.href,
      redirect,
      redirectPath,
      kind: canonicalRecordKindFromPath(redirectPath.replace(/\/?$/, "")),
      absoluteRedirect: /^https?:\/\//i.test(redirect),
      invalidRedirect: !canonicalRecordKindFromPath(redirectPath.replace(/\/?$/, "")),
    };
  } catch {
    return null;
  }
}

// The bare SWFI sign-in page (no redirect param) is the platform's auth
// entry — approved everywhere (source-of-truth rule; minutes C/G).
function isSwfiAuthEntryHref(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    return !parsed.searchParams.get("redirect");
  } catch {
    return false;
  }
}

function classifyAnchor(anchor) {
  // Law change 2026-07-06 (source-of-truth rule; minutes C/G): the BARE
  // sign-in page (no redirect param) is the platform's auth entry — an
  // approved destination, not a record link and not a leak.
  if (isSwfiAuthEntryHref(anchor.href) || isSwfiAuthEntryHref(anchor.raw)) {
    return { ...anchor, family: "swfi_auth_entry", kind: "", redirect: "" };
  }
  const signin = parseSwfiSignin(anchor.href) || parseSwfiSignin(anchor.raw);
  if (signin) return { ...anchor, family: signin.kind ? "swfi_record_handoff" : "swfi_signin", kind: signin.kind, redirect: signin.redirectPath, absoluteRedirect: signin.absoluteRedirect, invalidRedirect: signin.invalidRedirect };
  try {
    const parsed = new URL(anchor.href, origin);
    if (parsed.origin === originUrl.origin && parsed.pathname.startsWith(basePath || "/")) {
      const appPath = parsed.pathname.slice(basePath.length) || "/";
      if (/^\/profiles\/detail\/?/i.test(appPath)) return { ...anchor, family: "internal_detail", kind: "entities", redirect: `${appPath}${parsed.search}${parsed.hash}` };
      if (/^\/transactions\/detail\/?/i.test(appPath)) return { ...anchor, family: "internal_detail", kind: "transactions", redirect: `${appPath}${parsed.search}${parsed.hash}` };
      if (/^\/mandates\/detail\/?/i.test(appPath)) return { ...anchor, family: "internal_detail", kind: "compass", redirect: `${appPath}${parsed.search}${parsed.hash}` };
      if (/^\/people\/detail\/?/i.test(appPath)) return { ...anchor, family: "internal_detail", kind: "people", redirect: `${appPath}${parsed.search}${parsed.hash}` };
      if (/^\/research\/detail\/?/i.test(appPath)) return { ...anchor, family: "research", kind: "research", redirect: appPath };
      return { ...anchor, family: "internal", kind: "", redirect: "" };
    }
    if (["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname) && /^\/v1\//i.test(parsed.pathname)) {
      return { ...anchor, family: "raw_swfi_record", kind: "", redirect: "" };
    }
    if (["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname) && parsed.searchParams.get("p")) {
      return { ...anchor, family: "raw_legacy_article", kind: "research", redirect: "" };
    }
    if (["mailto:", "tel:"].includes(parsed.protocol)) return { ...anchor, family: "contact", kind: "", redirect: "" };
    return { ...anchor, family: "external", kind: "", redirect: "" };
  } catch {
    return { ...anchor, family: "invalid", kind: "", redirect: "" };
  }
}

function linkFailures(route, links) {
  const failures = [];
  const rawRecords = links.filter((link) => link.family === "raw_swfi_record");
  if (rawRecords.length) failures.push(`raw_swfi_record_links:${rawRecords.slice(0, 6).map((link) => link.text || link.raw).join("|")}`);
  const badSignin = links.filter((link) => link.family === "swfi_signin" && (!/Sign In/i.test(link.text || "") || link.invalidRedirect || link.absoluteRedirect));
  if (badSignin.length) failures.push(`non_record_swfi_signin_links:${badSignin.slice(0, 6).map((link) => link.text || link.raw).join("|")}`);
  const absoluteRecordRedirects = links.filter((link) => link.family === "swfi_record_handoff" && link.absoluteRedirect);
  if (absoluteRecordRedirects.length) failures.push(`absolute_record_redirects:${absoluteRecordRedirects.slice(0, 6).map((link) => link.text || link.redirect).join("|")}`);
  const leakedSourceParams = links.filter((link) => /(?:[?&](?:source|url)=|%3F(?:source|url)%3D|%26(?:source|url)%3D|source_url|source_record_id|source_gap|schema_version|ObjectId|Backend ID|Active Mirror|No internal record mapping|citation-only)/i.test([
    link.href,
    link.raw,
    link.sourceHref,
    link.sourceUrl,
    link.title,
    link.ariaLabel,
    link.outerHTML,
  ].filter(Boolean).join(" ")));
  if (leakedSourceParams.length) failures.push(`source_param_or_token_leaks:${leakedSourceParams.slice(0, 6).map((link) => link.text || link.raw).join("|")}`);
  const unapprovedExternal = links.filter((link) => link.family === "external").filter((link) => {
    try {
      const host = new URL(link.href).hostname;
      if (["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(host)) return true;
      return !allowedExternalHosts.has(host);
    } catch {
      return true;
    }
  });
  if (unapprovedExternal.length) failures.push(`unapproved_external_links:${unapprovedExternal.slice(0, 6).map((link) => link.text || link.href).join("|")}`);

  const expected = routeExpectations[route] || {};
  for (const [kind, count] of Object.entries(expected)) {
    if (kind === "exact") continue;
    const actual = links.filter((link) => link.kind === kind).length;
    if (actual < count) failures.push(`${kind}_record_links_${actual}_lt_${count}`);
  }
  for (const exact of expected.exact || []) {
    const match = links.find((link) => exact.text.test(link.text || "") && link.redirect === exact.redirect);
    if (!match) failures.push(`missing_exact_mapping:${exact.redirect}`);
  }
  return failures;
}

function leakageFailures(bodyText) {
  const failures = [];
  for (const pattern of forbiddenText) {
    const match = bodyText.match(pattern);
    if (match) failures.push(`visible_language_leak:${match[0]}`);
  }
  return [...new Set(failures)];
}

function expectedKindsForRoute(route) {
  return Object.keys(routeExpectations[route] || {}).filter((kind) => kind !== "exact");
}

async function inspectRoute(browser, route) {
  const consoleErrors = [];
  const failedRequests = [];
  let page;
  const result = {
    route,
    url: appUrl(route),
    final_url: "",
    status: 0,
    counts: {},
    samples: {},
    failures: [],
  };
  try {
    page = await browser.newPage({ viewport: route.includes("profiles/?filter") ? { width: 1366, height: 900 } : { width: 1440, height: 1050 } });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) consoleErrors.push(`${message.type()}:${message.text()}`);
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      if (/ERR_ABORTED/i.test(request.failure()?.errorText || "")) return;
      if (!request.url().includes("/cdn-cgi/rum")) failedRequests.push(request.url());
    });

    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result.status = response?.status() || 0;
    await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 120, null, { timeout: 10_000 }).catch(() => null);
    const expected = routeExpectations[route] || {};
    const expectedKinds = expectedKindsForRoute(route);
    if (expectedKinds.length || expected.exact?.length) {
      const transactionHeavyRoute = /^\/(transactions|deals)\//i.test(route);
      const readinessTimeoutMs = transactionHeavyRoute ? 120_000 : route.includes("profiles/?filter") ? 120_000 : 90_000;
      await page.waitForFunction((expectation) => {
        const hrefs = [...document.querySelectorAll("a[href]")].map((anchor) => {
          try {
            return {
              href: decodeURIComponent(anchor.href),
              text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
            };
          } catch {
            return {
              href: anchor.href,
              text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "),
            };
          }
        });
        const hasKind = (kind) => {
          if (kind === "research") {
            return hrefs.some((anchor) => {
              if (/\/swficc\/research\/detail\/?\?/i.test(anchor.href) || /\/research\/detail\/?\?/i.test(anchor.href)) return true;
              try {
                const parsed = new URL(anchor.href);
                return ["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname) && Boolean(parsed.searchParams.get("p"));
              } catch {
                return false;
              }
            });
          }
          const handoffPath = {
            entities: "/v1/entities/",
            transactions: "/v1/transactions/",
            compass: "/v1/compass/",
            people: "/v1/people/",
          }[kind];
          if (handoffPath && hrefs.some((anchor) => /https:\/\/www\.swfi\.com\/v1\/signin\/\?/i.test(anchor.href) && decodeURIComponent(anchor.href).includes(handoffPath))) {
            return true;
          }
          return false;
        };
        const hasExact = (exact) => hrefs.some((anchor) => {
          const pattern = new RegExp(exact.text, "i");
          return pattern.test(anchor.text) && decodeURIComponent(anchor.href).includes(exact.redirect);
        });
        return expectation.kinds.every(hasKind) && expectation.exact.every(hasExact);
      }, {
        kinds: expectedKinds,
        exact: (expected.exact || []).map((exact) => ({ text: exact.text.source, redirect: exact.redirect })),
      }, { timeout: readinessTimeoutMs }).catch(() => null);
    }
    await page.waitForTimeout(500);
    result.final_url = page.url();
    const snapshot = await page.evaluate(() => ({
      bodyText: document.body?.innerText || "",
      links: [...document.querySelectorAll("a[href]")].map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return {
          text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 140),
          href: anchor.href,
          raw: anchor.getAttribute("href") || "",
          target: anchor.getAttribute("target") || "",
          sourceState: anchor.getAttribute("data-source-state") || "",
          recordLink: anchor.getAttribute("data-record-link") || "",
          sourceHref: anchor.getAttribute("data-source-href") || "",
          sourceUrl: anchor.getAttribute("data-source-url") || "",
          title: anchor.getAttribute("title") || "",
          ariaLabel: anchor.getAttribute("aria-label") || "",
          outerHTML: anchor.outerHTML.slice(0, 1000),
          visible: rect.width > 0 && rect.height > 0,
        };
      }),
    }));
    const links = snapshot.links.filter((link) => link.visible || link.text || link.raw).map(classifyAnchor);
    result.counts = links.reduce((acc, link) => {
      acc[link.family] = (acc[link.family] || 0) + 1;
      if (link.kind) acc[link.kind] = (acc[link.kind] || 0) + 1;
      return acc;
    }, {});
    result.samples = {
      swfi_record_handoffs: links.filter((link) => link.family === "swfi_record_handoff").slice(0, 12),
      internal_details: links.filter((link) => link.family === "internal_detail").slice(0, 12),
      raw_swfi_records: links.filter((link) => link.family === "raw_swfi_record").slice(0, 12),
      research: links.filter((link) => link.family === "research").slice(0, 8),
    };
    if (result.status >= 400 || !result.status) result.failures.push(`http_${result.status || "missing"}`);
    const bodyText = snapshot.bodyText.trim();
    const newsletterFormOnly = route === "/newsletter-subscription/"
      && /Subscribe to Our Newsletter/i.test(bodyText)
      && /Email/i.test(bodyText)
      && /Subscribe/i.test(bodyText);
    if (bodyText.length < 300 && !newsletterFormOnly) result.failures.push("blank_or_too_little_visible_text");
    result.failures.push(...leakageFailures(snapshot.bodyText));
    result.failures.push(...linkFailures(route, links));
    if (consoleErrors.length) result.failures.push(`console_or_page_errors:${consoleErrors.slice(0, 3).join("|")}`);
    if (failedRequests.length) result.failures.push(`failed_requests:${failedRequests.slice(0, 3).join("|")}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    if (page) await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const results = [];
  for (const route of routes) {
    console.error(`[map-leakage] inspecting ${route}`);
    const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"], timeout: 30_000 });
    try {
      results.push(await inspectRoute(browser, route));
    } catch (error) {
      results.push({
        route,
        url: appUrl(route),
        final_url: "",
        status: 0,
        counts: {},
        samples: {},
        failures: [error.message],
        ok: false,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  }
  const failures = results.flatMap((result) => result.ok ? [] : result.failures.map((failure) => ({ route: result.route, failure })));
  const receipt = {
    schema_version: "swfipn.link_mapping_leakage_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: {
      routes: results.length,
      failures: failures.length,
      link_counts: results.reduce((acc, result) => {
        for (const [key, value] of Object.entries(result.counts || {})) acc[key] = (acc[key] || 0) + value;
        return acc;
      }, {}),
    },
    results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath, failures: failures.slice(0, 20) }, null, 2));
  if (failures.length) process.exit(1);
  process.exit(0);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
