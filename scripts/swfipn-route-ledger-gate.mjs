#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const ledgerPath = path.join(repoRoot, "docs", "swfipn-route-ledger.json");
const receiptPath = path.join(outputDir, "swfipn-route-ledger-gate-latest.json");
const reportPath = path.join(outputDir, "swfipn-route-ledger-latest.md");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originUrl = new URL(origin);
const originHost = originUrl.hostname;
const basePath = originUrl.pathname.replace(/\/$/, "");
const routeTimeoutMs = Number(process.env.SWFIPN_ROUTE_LEDGER_TIMEOUT_MS || 90_000);
const runAuthCheck = /^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_ROUTE_LEDGER_AUTH || ""));
const username = loadSecret("SWFIPN_AUTH_TEST_USERNAME", "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"]).trim();
const password = loadSecret("SWFIPN_AUTH_TEST_PASSWORD", "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"], false);

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function envList(name, fallback) {
  const raw = String(process.env[name] || "");
  if (!raw) return fallback;
  const parsed = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function keychainLookup(services) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_AUTH_USE_KEYCHAIN || "1"))) return "";
  for (const account of envList("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"])) {
    for (const service of services) {
      try {
        const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        if (value) return value;
      } catch {
        // Try the next configured account/service.
      }
    }
  }
  return "";
}

function loadSecret(envName, serviceEnvName, defaultServices, strip = true) {
  const direct = process.env[envName] || "";
  if (direct) return strip ? direct.trim() : direct;
  const value = keychainLookup(envList(serviceEnvName, defaultServices));
  return strip ? value.trim() : value.replace(/\n$/, "");
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function readLedger() {
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  return {
    ...ledger,
    routes: Array.isArray(ledger.routes) ? ledger.routes : [],
    forbidden_visible_text: Array.isArray(ledger.forbidden_visible_text) ? ledger.forbidden_visible_text : [],
  };
}

function urlFor(routePath) {
  return routePath === "/" ? origin : new URL(routePath.replace(/^\//, ""), origin).href;
}

function appRouteFromHref(href) {
  try {
    const parsed = new URL(href, origin);
    if (parsed.origin !== originUrl.origin) return "";
    if (!parsed.pathname.startsWith(basePath || "/")) return "";
    let route = parsed.pathname.slice(basePath.length) || "/";
    if (!route.startsWith("/")) route = `/${route}`;
    if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
    return route;
  } catch {
    return "";
  }
}

function isCanonicalSwfiHandoffUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname === "/" && /^\?p=\d+/i.test(parsed.search)) return true;
    if (parsed.pathname === "/v1/signin/" || parsed.pathname === "/v1/signin") {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect) return true;
      try {
        const redirectUrl = new URL(redirect, originUrl.origin);
        return redirectUrl.hostname === originHost;
      } catch {
        return redirect.startsWith(basePath || "/");
      }
    }
    return /^\/v1\/(entities|people|transactions|compass|news)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function bodyExcerpt(body) {
  return body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 24);
}

async function waitForBody(page, required, timeout = routeTimeoutMs) {
  const startedAt = Date.now();
  let body = "";
  while (Date.now() - startedAt < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const ready = required.every((text) => lower.includes(String(text).toLowerCase()));
    if (ready && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

function textFailures(body, forbidden) {
  return forbidden
    .filter((text) => body.includes(text))
    .map((text) => `forbidden_visible:${text}`);
}

async function inspectTableControls(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    return {
      showing: /Showing\s+[0-9,]+\s+of\s+[0-9,]+/i.test(body),
      filter_inputs: document.querySelectorAll('input[type="search"], input[placeholder*="Filter" i]').length,
      row_limit_selects: Array.from(document.querySelectorAll("select")).filter((select) => /5|10|25|50|100/.test(select.textContent || "")).length,
      sort_buttons: document.querySelectorAll("table th button").length,
      pagination_buttons: Array.from(document.querySelectorAll("button")).filter((button) => /Previous|Next/i.test(button.textContent || "")).length,
    };
  });
}

async function waitForTableControls(page, timeout = routeTimeoutMs) {
  const startedAt = Date.now();
  let controls = await inspectTableControls(page);
  while (Date.now() - startedAt < timeout) {
    if (controls.showing && controls.row_limit_selects >= 1 && controls.sort_buttons >= 2) return controls;
    await page.waitForTimeout(750);
    controls = await inspectTableControls(page);
  }
  return controls;
}

async function inspectSelects(page, selects = []) {
  const results = [];
  for (const spec of selects) {
    const count = await page.locator(`select[name="${spec.name}"] option`).count().catch(() => 0);
    results.push({
      name: spec.name,
      min_options: spec.min_options,
      options: count,
      ok: count >= spec.min_options,
    });
  }
  return results;
}

async function inspectRoute(context, route, ledger) {
  const page = await context.newPage();
  await page.setViewportSize({ width: route.path === "/" ? 1440 : 1366, height: 1000 });
  const result = {
    id: route.id,
    class: route.class,
    status: route.status,
    path: route.path,
    source: route.source,
    ok: true,
    http_status: null,
    final_url: "",
    failures: [],
    body_first: [],
    counts: {},
    table_controls: null,
    selects: [],
  };
  try {
    if (route.protected_record_handoff && !runAuthCheck) {
      const response = await context.request.get(urlFor(route.path), { maxRedirects: 0, timeout: routeTimeoutMs });
      result.http_status = response.status();
      result.final_url = response.headers().location || "";
      if (![301, 302, 303, 307, 308].includes(response.status())) result.failures.push(`expected_auth_redirect_got_${response.status()}`);
      if (!isCanonicalSwfiHandoffUrl(result.final_url)) result.failures.push(`noncanonical_auth_handoff:${result.final_url || "missing"}`);
      result.body_first = ["Protected record handoff verified against SWFI-owned sign-in."];
      result.ok = result.failures.length === 0;
      return result;
    }

    const response = await page.goto(urlFor(route.path), { waitUntil: "domcontentloaded", timeout: routeTimeoutMs });
    result.http_status = response?.status() || null;
    result.final_url = page.url();
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);

    const body = await waitForBody(page, route.required_text || []);
    result.body_first = bodyExcerpt(body);
    for (const text of route.required_text || []) {
      if (!body.toLowerCase().includes(String(text).toLowerCase())) result.failures.push(`missing_text:${text}`);
    }
    result.failures.push(...textFailures(body, ledger.forbidden_visible_text));

    result.counts.anchors = await page.locator("a[href]").count().catch(() => 0);
    result.counts.detail_links = await page.locator('a[href*="/detail/"], a[data-dashboard-target*="/detail/"]').count().catch(() => 0);
    result.counts.source_links = await page.locator('a[href*="/source/"], [data-source-state="on-file"], [data-source-path]').count().catch(() => 0);
    result.counts.mirror_record_links = await page.locator([
      'a[href*="/swficc/profiles/detail/"]',
      'a[href*="/swficc/transactions/detail/"]',
      'a[href*="/swficc/mandates/detail/"]',
      'a[href*="/swficc/people/detail/"]',
      'a[href*="/swficc/research/detail/"]',
      'a[data-dashboard-target*="/profiles/detail/"]',
      'a[data-dashboard-target*="/transactions/detail/"]',
      'a[data-dashboard-target*="/mandates/detail/"]',
      'a[data-dashboard-target*="/people/detail/"]',
      'a[data-dashboard-target*="/research/detail/"]',
    ].join(", ")).count().catch(() => 0);
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => anchor.href || anchor.getAttribute("href") || ""));
    const swfiHrefs = hrefs.filter((href) => /^https?:\/\/(?:www\.)?swfi\.com/i.test(href) || /^https?:\/\/cms\.swfi\.com/i.test(href));
    result.counts.canonical_swfi_handoff_links = swfiHrefs.filter((href) => isCanonicalSwfiHandoffUrl(href)).length;
    result.counts.external_swfi_links = swfiHrefs.filter((href) => !isCanonicalSwfiHandoffUrl(href)).length;
    if (route.min_detail_links && result.counts.detail_links < route.min_detail_links) {
      result.failures.push(`detail_links_${result.counts.detail_links}_lt_${route.min_detail_links}`);
    }
    if (route.min_source_links && result.counts.source_links < route.min_source_links) {
      result.failures.push(`source_links_${result.counts.source_links}_lt_${route.min_source_links}`);
    }
    const approvedRecordLinks = result.counts.mirror_record_links + result.counts.canonical_swfi_handoff_links;
    if (route.min_mirror_record_links && approvedRecordLinks < route.min_mirror_record_links) {
      result.failures.push(`approved_record_links_${approvedRecordLinks}_lt_${route.min_mirror_record_links}`);
    }
    if (result.counts.external_swfi_links > 0) result.failures.push(`external_swfi_links_${result.counts.external_swfi_links}_gt_0`);

    if (route.requires_table_controls) {
      result.table_controls = await waitForTableControls(page);
      if (!result.table_controls.showing) result.failures.push("table_controls_missing_showing_count");
      if (result.table_controls.filter_inputs < 1) result.failures.push("table_controls_missing_filter");
      if (result.table_controls.row_limit_selects < 1) result.failures.push("table_controls_missing_row_limit");
      if (result.table_controls.sort_buttons < 2) result.failures.push(`table_controls_sort_buttons_${result.table_controls.sort_buttons}_lt_2`);
    }

    if (route.selects?.length) {
      result.selects = await inspectSelects(page, route.selects);
      for (const item of result.selects) {
        if (!item.ok) result.failures.push(`select_${item.name}_options_${item.options}_lt_${item.min_options}`);
      }
    }

    if (route.required_links?.length) {
      for (const expected of route.required_links) {
        const count = await page.locator(`a[href*="${expected}"], a[data-dashboard-target*="${expected}"]`).count().catch(() => 0);
        if (!count) result.failures.push(`missing_required_link:${expected}`);
      }
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function routeBases(routes) {
  return routes
    .filter((route) => route.status === "live")
    .map((route) => route.path.split("?")[0])
    .map((route) => route === "/" ? "/" : route.replace(/\/?$/, "/"));
}

async function readAnchors(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
    text: anchor.textContent?.trim().replace(/\s+/g, " ") || "",
    href: anchor.href,
    raw: anchor.getAttribute("href") || "",
    dashboardTarget: anchor.getAttribute("data-dashboard-target") || "",
  })));
}

function targetHref(link) {
  return link.dashboardTarget || link.raw || link.href;
}

function isAllowedInternalRoute(route, allowedRoutes) {
  if (!route) return false;
  if (allowedRoutes.has(route)) return true;
  return [
    "/profiles/detail/",
    "/people/detail/",
    "/transactions/detail/",
    "/mandates/detail/",
    "/research/detail/",
    "/source/",
    "/login/",
    "/logout/",
  ].some((prefix) => route.startsWith(prefix));
}

async function inspectPublicNavigation(browser, ledger) {
  const pages = ["/", "/about/", "/about-us/our-team/", "/solutions/", "/demo/", "/contact/", "/newsletter-subscription/", "/privacy-policy/", "/terms-of-use/", "/cookie-policy/", "/accessibility/"];
  const hiddenRoutes = new Set(ledger.routes.filter((route) => route.status === "hidden").map((route) => route.path.replace(/\/?$/, "/")));
  const allowedRoutes = new Set(routeBases(ledger.routes));
  const result = { id: "public_navigation_contract", ok: true, failures: [], pages: [] };
  for (const routePath of pages) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageResult = { path: routePath, ok: true, failures: [], anchors: [] };
    try {
      const response = await page.goto(urlFor(routePath), { waitUntil: "domcontentloaded", timeout: routeTimeoutMs });
      if (!response || response.status() >= 400) pageResult.failures.push(`http_${response?.status() || "missing"}`);
      await waitForBody(page, ["SWFI"], 45_000);
      const anchors = await readAnchors(page);
      pageResult.anchors = anchors.slice(0, 80);
      for (const link of anchors) {
        const target = targetHref(link);
        const href = link.href || "";
        if (/^mailto:/i.test(link.raw) || /^tel:/i.test(link.raw)) continue;
        if (isAllowedExternalPublicHref(href) || isAllowedExternalPublicHref(target)) continue;
        if (isCanonicalSwfiHandoffUrl(href) || isCanonicalSwfiHandoffUrl(target)) continue;
        if (/^https?:\/\/(www\.)?swfi\.com/i.test(href) || /^https?:\/\/(www\.)?swfi\.com/i.test(target)) {
          pageResult.failures.push(`external_swfi_href:${link.text || link.raw}`);
          continue;
        }
        const route = appRouteFromHref(target);
        if (hiddenRoutes.has(route)) pageResult.failures.push(`hidden_route_linked:${route}:${link.text || link.raw}`);
        if (!isAllowedInternalRoute(route, allowedRoutes)) pageResult.failures.push(`unsupported_internal_link:${target}:${link.text || link.raw}`);
      }
      for (const label of ledger.label_only_unlinked || []) {
        const linked = anchors.filter((link) => link.text === label);
        if (linked.some((link) => !isAllowedExternalPublicHref(link.href) && !isAllowedExternalPublicHref(targetHref(link)))) {
          pageResult.failures.push(`label_should_not_be_linked:${label}`);
        }
      }
    } catch (error) {
      pageResult.failures.push(error.message);
    } finally {
      await page.close().catch(() => {});
    }
    pageResult.ok = pageResult.failures.length === 0;
    result.pages.push(pageResult);
    result.failures.push(...pageResult.failures.map((failure) => `${routePath}:${failure}`));
  }
  result.ok = result.failures.length === 0;
  return result;
}

function isAllowedExternalPublicHref(href) {
  if (!href) return false;
  return [
    /^https:\/\/twitter\.com\/swfinstitute/i,
    /^https:\/\/www\.linkedin\.com\/company\/sovereign-wealth-fund-institute-inc-/i,
    /^https:\/\/www\.facebook\.com\/institutionalinvestorsSWFI\/?/i,
  ].some((pattern) => pattern.test(href));
}

async function loginContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (!runAuthCheck) return { context, authenticated: false, skipped: true, failures: ["auth_check_disabled_phase1_swfi_handoff"] };
  if (!username || !password) return { context, authenticated: false, failures: ["auth_credentials_not_configured"] };
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(urlFor("/login/?next=/swficc/"), { waitUntil: "domcontentloaded", timeout: routeTimeoutMs });
    await page.locator('input[name="username"]').fill(username, { timeout: 30_000 });
    await page.locator('input[name="password"]').fill(password, { timeout: 30_000 });
    await Promise.all([
      page.waitForURL(/\/swficc\/(?:$|[?#])/, { timeout: routeTimeoutMs }).catch(() => null),
      page.locator('button[type="submit"]').click({ timeout: 30_000 }),
    ]);
    const sessionUrl = new URL("/api/session/status/v1", originUrl.origin).href;
    const response = await context.request.get(sessionUrl, { timeout: 30_000 });
    if (response.status() !== 200) failures.push(`auth_session_status_${response.status()}`);
  } catch (error) {
    failures.push(`auth_login_failed:${error.message}`);
  } finally {
    await page.close().catch(() => {});
  }
  return { context, authenticated: failures.length === 0, failures };
}

function renderMarkdown(receipt) {
  const live = receipt.routes.filter((route) => route.status === "live");
  const hidden = receipt.ledger.routes.filter((route) => route.status === "hidden");
  const lines = [
    "# SWFIPN Route Migration Ledger",
    "",
    `- Status: ${receipt.status.toUpperCase()}`,
    `- Generated: ${receipt.generated_at}`,
    `- Origin: ${receipt.origin}`,
    `- Product truth: ${receipt.ledger.product_truth.fact_rail}`,
    `- Provenance: ${receipt.ledger.product_truth.provenance_rail}`,
    `- Live route samples: ${live.length}`,
    `- Failures: ${receipt.summary.failures}`,
    "",
    "## Live Routes",
    "",
    "| Route | Class | Source | Proof |",
    "| --- | --- | --- | --- |",
  ];
  for (const route of live) {
    const proof = route.ok ? "PASS" : `FAIL: ${route.failures.slice(0, 3).join("; ")}`;
    lines.push(`| \`${route.path}\` | ${route.class} | ${route.source} | ${proof} |`);
  }
  lines.push("", "## Hidden / Not Public", "", "| Route | Class | Reason |", "| --- | --- | --- |");
  for (const route of hidden) {
    lines.push(`| \`${route.path}\` | ${route.class} | Hidden from public navigation |`);
  }
  lines.push("", "## Label-Only Items", "");
  lines.push(...receipt.ledger.label_only_unlinked.map((label) => `- ${label}`));
  if (receipt.failures.length) {
    lines.push("", "## Failures", "");
    for (const failure of receipt.failures) lines.push(`- ${failure.type}: ${failure.id || failure.path || ""} ${failure.failures.join("; ")}`);
  }
  return `${lines.join("\n")}\n`;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const ledger = readLedger();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const routes = [];
  let navigation = null;
  let auth = null;
  try {
    auth = await loginContext(browser);
    for (const route of ledger.routes.filter((item) => item.status === "live")) {
      console.error(`[swfipn-route-ledger] ${route.id} ${route.path}`);
      routes.push(await inspectRoute(auth.context, route, ledger));
    }
    console.error("[swfipn-route-ledger] public navigation");
    navigation = await inspectPublicNavigation(browser, ledger);
  } finally {
    await auth?.context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  const failures = [
    ...(auth?.authenticated || auth?.skipped || !username || !password ? [] : [{ type: "auth", id: "authenticated_context", failures: auth?.failures || ["auth_not_run"] }]),
    ...routes.filter((route) => !route.ok).map((route) => ({ type: "route", id: route.id, path: route.path, failures: route.failures })),
    ...(navigation?.ok ? [] : [{ type: "navigation", id: navigation?.id || "public_navigation_contract", failures: navigation?.failures || ["not_run"] }]),
  ];
  const receipt = {
    schema_version: "swfipn.route_ledger_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    ledger_path: ledgerPath,
    status: failures.length ? "fail" : "pass",
    summary: {
      routes: routes.length,
      hidden_routes: ledger.routes.filter((route) => route.status === "hidden").length,
      failures: failures.length,
    },
    ledger,
    routes,
    navigation,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdown(receipt));
  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    receipt: receiptPath,
    report: reportPath,
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
