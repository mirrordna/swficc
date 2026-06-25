#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-table-controls-proof-latest.json");
const gateLevel = process.env.SWFIPN_TABLE_CONTROLS_LEVEL || process.env.SWFIPN_TRUTH_AUDIT_LEVEL || "full";
const routeLimit = Number(process.env.SWFIPN_TABLE_CONTROLS_ROUTE_LIMIT || 0);
const renderTimeoutMs = Number(process.env.SWFIPN_TABLE_CONTROLS_RENDER_TIMEOUT_MS || (gateLevel === "smoke" ? 45_000 : 180_000));
const controlTimeoutMs = Number(process.env.SWFIPN_TABLE_CONTROLS_CONTROL_TIMEOUT_MS || (gateLevel === "smoke" ? 8_000 : 180_000));
const SMOKE_ROUTE_SET = new Set(["/", "/profiles/", "/transactions/", "/mandates/", "/research/"]);
const PUBLIC_ROUTE_SET = new Set([
  "/",
  "/profiles/",
  "/comparisons/",
  "/people/",
  "/deals/",
  "/transactions/",
  "/mandates/",
  "/search/",
  "/reports/",
  "/research/",
]);
const username = loadSecret("SWFIPN_AUTH_TEST_USERNAME", "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"]).trim();
const password = loadSecret("SWFIPN_AUTH_TEST_PASSWORD", "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"], false);

const ROUTES = [
  { route: "/", minControls: 4, requiredBodyText: "Top Active Allocators (Last 90 Days)" },
  { route: "/profiles/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 590_000, requiredBodyText: "Entity Name", testSort: true, filterTerm: "Sovereign Wealth Fund", testRowLimit: true, testPagination: true, expectServerFilter: "/api/source-data/search/v1", serverBackedControls: true },
  { route: "/comparisons/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 590_000, requiredBodyText: "Peer Comparisons", testSort: true, filterTerm: "Sovereign Wealth Fund", testRowLimit: true, testPagination: true, expectServerFilter: "/api/source-data/search/v1", serverBackedControls: true },
  { route: "/people/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 114_000, testSort: true, filterTerm: "Vijay", testRowLimit: true, testPagination: true, expectServerFilter: "/api/source-data/search/v1", serverBackedControls: true },
  { route: "/deals/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 180_000, requiredBodyText: "Amount (USD)", testSort: true, filterTerm: "Andreessen", testRowLimit: true, testPagination: true, expectServerFilter: "/api/transactions/v1", serverBackedControls: true },
  { route: "/transactions/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 180_000, requiredBodyText: "Amount (USD)", testSort: true, filterTerm: "Andreessen", testRowLimit: true, testPagination: true, expectServerFilter: "/api/transactions/v1", serverBackedControls: true },
  { route: "/mandates/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 30, testSort: true, filterTerm: "CalPERS", testRowLimit: true, testPagination: true, serverBackedControls: true },
  { route: "/search/?q=Prem", minControls: 1, testSort: true, filterTerm: "Prem", testRowLimit: true },
  { route: "/search/?q=Real%20Estate", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredBodyText: "Real Estate", testSort: true, filterTerm: "Real Estate", testRowLimit: true },
  { route: "/reports/", minControls: 5, requiredShowingPrefix: "Showing 5 of", requiredTotalAtLeast: 10, testSort: true, filterTerm: "Norway", testRowLimit: true, testPagination: true },
  { route: "/research/", minControls: 1, requiredShowingPrefix: "Showing 5 of", requiredBodyText: "Research / News", testSort: true, filterTerm: "SWFI", testRowLimit: true, testPagination: true },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final", "/Users/mirror-pro/repos/SWFI2.0-final-frontend"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeBase(input) {
  const value = input || "http://127.0.0.1:8353/swficc/";
  return value.endsWith("/") ? value : `${value}/`;
}

function routeUrl(base, route) {
  if (route === "/") return base;
  return new URL(route.replace(/^\//, ""), base).href;
}

function rootOriginUrl(base, route) {
  const parsed = new URL(base);
  return new URL(route.replace(/^\//, ""), `${parsed.origin}/`).href;
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
        // Keep trying configured Keychain accounts/services.
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

function selectedRoutes() {
  const routes = gateLevel === "smoke" ? ROUTES.filter((spec) => SMOKE_ROUTE_SET.has(spec.route)) : ROUTES;
  return routeLimit > 0 ? routes.slice(0, routeLimit) : routes;
}

function requiresAuth(spec) {
  const parsed = new URL(routeUrl("http://example.test/swficc/", spec.route));
  const route = parsed.pathname.replace(/^\/swficc/, "") || "/";
  return !PUBLIC_ROUTE_SET.has(route.endsWith("/") ? route : `${route}/`);
}

function routeTimeout() {
  return renderTimeoutMs;
}

function controlTimeout() {
  return controlTimeoutMs;
}

function filterControlTimeout(spec) {
  return spec.expectServerFilter ? Math.max(controlTimeout(), 25_000) : controlTimeout();
}

function serverBackedControlTimeout(spec) {
  return spec.serverBackedControls ? Math.max(controlTimeout(), 25_000) : controlTimeout();
}

function isInsideBase(base, href) {
  const parsed = new URL(href);
  const root = new URL(base);
  const basePath = root.pathname.replace(/\/$/, "");
  return parsed.origin === root.origin && parsed.pathname.startsWith(basePath || "/");
}

async function findRowLimitSelectIndex(page) {
  return page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select"));
    return selects.findIndex((select) => {
      const values = Array.from(select.querySelectorAll("option")).map((option) => option.value || option.textContent?.trim() || "");
      return values.includes("5") && values.includes("25");
    });
  });
}

async function exerciseControls(page, base, spec, result) {
  result.final_url = page.url();
  result.interactions = {
    stayed_on_base: isInsideBase(base, result.final_url),
    sort_changed: false,
    row_limit_changed: false,
    pagination_changed: false,
    filter_changed: false,
  };
  if (!result.interactions.stayed_on_base) result.failures.push(`wrong_host_or_base:${result.final_url}`);

  if (spec.testSort) {
    const sortable = page.locator("thead th button").first();
    if (await sortable.count()) {
      const before = await sortable.innerText();
      await sortable.click({ timeout: 10_000 });
      await page.waitForTimeout(250);
      const after = await sortable.innerText();
      result.interactions.sort_changed = after !== before && /\b(asc|desc)\b/i.test(after);
      if (!result.interactions.sort_changed) result.failures.push("sort_control_inert");
    } else {
      result.failures.push("missing_sort_button_for_interaction");
    }
  }

  if (spec.testRowLimit) {
    const selectIndex = await findRowLimitSelectIndex(page);
    if (selectIndex < 0) {
      result.failures.push("missing_row_limit_select_for_interaction");
    } else {
      await page.locator("select").nth(selectIndex).selectOption("10", { timeout: 10_000 });
      result.interactions.row_limit_changed = await page.waitForFunction(
        () => {
          const rowSelect = Array.from(document.querySelectorAll("select")).find((select) => {
            const values = Array.from(select.querySelectorAll("option")).map((option) => option.value || option.textContent?.trim() || "");
            return values.includes("5") && values.includes("25");
          });
          return rowSelect?.value === "10"
            && Array.from(document.body.innerText.matchAll(/Showing [^\n]+/g)).some((match) => match[0].startsWith("Showing 10 of"));
        },
        null,
        { timeout: serverBackedControlTimeout(spec) },
      ).then(() => true).catch(() => false);
      if (!result.interactions.row_limit_changed) result.failures.push("row_limit_control_inert");
    }
  }

  if (spec.testPagination) {
    const beforePage = await currentPageLabel(page);
    let clicked = false;
    for (let attempt = 0; attempt < 2 && !result.interactions.pagination_changed; attempt += 1) {
      const ready = await page.waitForFunction(
        () => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Next" && !button.disabled),
        null,
        { timeout: serverBackedControlTimeout(spec) },
      ).then(() => true).catch(() => false);
      clicked = ready && await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const next = buttons.find((button) => button.textContent?.trim() === "Next" && !button.disabled);
        if (!next) return false;
        next.click();
        return true;
      });
      if (!clicked) break;
      result.interactions.pagination_changed = await page.waitForFunction(
        (previous) => {
          const current = (document.body.innerText.match(/Page [^\n]+/) || [""])[0];
          return Boolean(current && current !== previous && !current.startsWith("Page 1 of "));
        },
        beforePage,
        { timeout: serverBackedControlTimeout(spec) },
      ).then(() => true).catch(() => false);
      if (result.interactions.pagination_changed && spec.serverBackedControls) {
        await waitForApiResponse(result.api_responses, (url) => {
          try {
            const parsed = new URL(url);
            return parsed.searchParams.get("page") === "2" && Number(parsed.searchParams.get("limit") || 0) >= 10;
          } catch {
            return false;
          }
        }, serverBackedControlTimeout(spec));
      }
    }
    if (!clicked) {
      result.failures.push("missing_enabled_next_pagination");
    } else if (!result.interactions.pagination_changed) result.failures.push("pagination_control_inert");
  }

  if (spec.filterTerm) {
    const filter = page.locator('input[placeholder="Filter rows"]').first();
    if (await filter.count()) {
      await filter.fill(spec.filterTerm, { timeout: 10_000 });
      const timeout = filterControlTimeout(spec);
      result.interactions.filter_changed = await page.waitForFunction(
        (term) => document.body.innerText.toLowerCase().includes(String(term).toLowerCase()) && /filtered [0-9,]+/.test(document.body.innerText),
        spec.filterTerm,
        { timeout },
      ).then(() => true).catch(() => false);
      if (!result.interactions.filter_changed) result.failures.push("filter_control_inert");
      if (spec.expectServerFilter) {
        const matchedRequest = await waitForMatchingRequest(result.api_requests, spec.expectServerFilter, spec.filterTerm, timeout);
        if (!matchedRequest) result.failures.push(`filter_not_sent_to_server:${spec.expectServerFilter}:q=${spec.filterTerm}`);
      }
    } else {
      result.failures.push("missing_filter_for_interaction");
    }
  }
}

async function waitForMatchingRequest(requests, pathPart, term, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (requests.some((url) => {
      try {
        const parsed = new URL(url);
        return parsed.pathname.includes(pathPart) && parsed.searchParams.get("q") === term;
      } catch {
        return false;
      }
    })) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function waitForApiResponse(responses, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.some((response) => response.status < 500 && predicate(response.url))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function currentPageLabel(page) {
  return page.evaluate(() => (document.body.innerText.match(/Page [^\n]+/) || [""])[0]).catch(() => "");
}

async function loginStorageState(browser, base) {
  if (!username || !password) throw new Error("auth_credentials_missing_for_protected_controls");
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(routeUrl(base, `/login/?next=${encodeURIComponent(new URL(base).pathname)}`), { waitUntil: "domcontentloaded", timeout: routeTimeout("/") });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`${new URL(base).pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[?#])`), { timeout: routeTimeout("/") }),
      page.locator('button[type="submit"]').click(),
    ]);
    const session = await context.request.get(rootOriginUrl(base, "/api/session/status/v1"), { timeout: 30_000 });
    if (session.status() !== 200) failures.push(`session_status_${session.status()}`);
    if (!failures.length) return await context.storageState();
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  throw new Error(`auth_context_failed:${failures.join("|")}`);
}

async function inspectRoute(browser, base, spec, audit, authStorageState) {
  const needsAuth = requiresAuth(spec);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: needsAuth ? authStorageState : { cookies: [], origins: [] } });
  const page = await context.newPage();
  const result = {
    route: spec.route,
    url: routeUrl(base, spec.route),
    authenticated: needsAuth,
    ok: true,
    failures: [],
    showing: [],
    filters: 0,
    selects: 0,
    sortable: 0,
    final_url: "",
    interactions: {},
    api_requests: [],
    api_responses: [],
    first_lines: [],
  };
  page.on("request", (request) => {
    if (request.url().includes("/api/")) result.api_requests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/")) result.api_responses.push({ url: response.url(), status: response.status() });
  });
  page.on("console", (msg) => {
    if (["error", "warning", "warn"].includes(msg.type())) {
      const text = msg.text();
      if (/ERR_QUIC_PROTOCOL_ERROR\.QUIC_TOO_MANY_RTOS/i.test(text)) return;
      if (/the server responded with a status of 401/i.test(text)) return;
      audit.console.push({ route: spec.route, type: msg.type(), text });
    }
  });
  page.on("pageerror", (err) => audit.pageErrors.push({ route: spec.route, text: err.message }));

  try {
    if (needsAuth && !authStorageState) result.failures.push("auth_credentials_missing_for_protected_controls");
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: routeTimeout(spec.route) });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    if (spec.requiredText) {
      await page.waitForFunction((text) => document.body?.innerText.includes(text), spec.requiredText, { timeout: routeTimeout(spec.route) });
    } else if (spec.requiredShowingPrefix) {
      await page.waitForFunction(
        (prefix) => Array.from(document.body.innerText.matchAll(/Showing [^\n]+/g)).some((match) => match[0].startsWith(String(prefix))),
        spec.requiredShowingPrefix,
        { timeout: routeTimeout(spec.route) },
      );
    } else {
      await page.waitForFunction(
        () => {
          const body = document.body?.innerText || document.body?.textContent || "";
          return body.includes("Showing") && !body.includes("Showing 0 of 0");
        },
        null,
        { timeout: routeTimeout(spec.route) },
      ).catch(() => {});
    }
    if (spec.requiredBodyText) {
      await page.waitForFunction((text) => document.body?.innerText.includes(text), spec.requiredBodyText, { timeout: routeTimeout(spec.route) });
    }
    await page.waitForFunction(
      () => {
        const rows = Array.from(document.querySelectorAll("tbody tr"));
        return !rows.length || rows.some((row) => row.innerText.trim().length > 0);
      },
      null,
      { timeout: routeTimeout(spec.route) },
    ).catch(() => {});

    const data = await page.evaluate((requiredBodyText) => {
      const visibleText = document.body.innerText || "";
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("script,style").forEach((element) => element.remove());
      const allText = clone.textContent || "";
      const body = visibleText.includes("Showing") ? visibleText : allText;
      return {
        showing: Array.from(body.matchAll(/Showing [^\n]+/g)).map((match) => match[0]).slice(0, 8),
        filters: Array.from(document.querySelectorAll('input[type="search"]')).length,
        selects: Array.from(document.querySelectorAll("select")).length,
        sortable: Array.from(document.querySelectorAll("thead th button")).length
          + Array.from(document.querySelectorAll("button")).filter((button) => /Result|Metric|Source|Detail|Institution|Deals|Sector|Region|Deal|Amount|Mandate|RFP|Deadline|Headline|Published|Link/i.test(button.innerText || button.textContent || "")).length,
        first_lines: body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 24),
        required_body_present: requiredBodyText ? body.includes(String(requiredBodyText)) : true,
      };
    }, spec.requiredBodyText || "");
    Object.assign(result, data);

    if (!spec.staticOnly && !result.showing.length) result.failures.push("missing_showing_count");
    if (!spec.staticOnly && result.showing.some((line) => line.includes("Showing 0 of 0"))) result.failures.push("zero_of_zero_count");
    if (!spec.staticOnly && spec.requiredText && !result.showing.some((line) => line.includes(spec.requiredText))) result.failures.push(`missing_required_count:${spec.requiredText}`);
    if (!spec.staticOnly && spec.requiredShowingPrefix && !result.showing.some((line) => line.startsWith(spec.requiredShowingPrefix))) result.failures.push(`missing_required_count_prefix:${spec.requiredShowingPrefix}`);
    if (!spec.staticOnly && spec.requiredTotalAtLeast && !result.showing.some((line) => showingTotal(line) >= spec.requiredTotalAtLeast)) result.failures.push(`showing_total_lt_${spec.requiredTotalAtLeast}`);
    if (spec.requiredBodyText && !result.required_body_present) result.failures.push(`missing_required_body:${spec.requiredBodyText}`);
    if (!spec.staticOnly && result.filters < 1) result.failures.push("missing_filter_input");
    if (!spec.staticOnly && result.selects < 1) result.failures.push("missing_row_limit_select");
    if (!spec.staticOnly && result.sortable < spec.minControls) result.failures.push(`sortable_controls_${result.sortable}_lt_${spec.minControls}`);
    if (!spec.staticOnly) await exerciseControls(page, base, spec, result);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }

  result.ok = result.failures.length === 0;
  return result;
}

function showingTotal(line) {
  const match = line.match(/Showing [\d,]+ of ([\d,]+)/);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

function shouldRetryRoute(result) {
  if (result.ok) return false;
  return result.failures.some((failure) => /Timeout|missing_showing_count|missing_filter_input|missing_row_limit_select/i.test(failure));
}

function retrySummary(result) {
  return {
    ok: result.ok,
    failures: result.failures,
    showing: result.showing,
    filters: result.filters,
    selects: result.selects,
    sortable: result.sortable,
    api_requests: result.api_requests?.slice(0, 8) || [],
  };
}

async function launchBrowser(chromium, baseHost, resolveIp) {
  return chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const audit = { console: [], pageErrors: [] };
  let browser = await launchBrowser(chromium, baseHost, resolveIp);
  const routes = selectedRoutes();
  let authStorageState = null;
  if (routes.some((spec) => requiresAuth(spec))) {
    authStorageState = await loginStorageState(browser, base);
  }

  const results = [];
  for (const spec of routes) {
    console.error(`[swfipn-table-controls] ${gateLevel} ${spec.route}`);
    const first = await inspectRoute(browser, base, spec, audit, authStorageState);
    if (shouldRetryRoute(first)) {
      console.error(`[swfipn-table-controls] retry ${spec.route}`);
      await browser.close().catch(() => {});
      browser = await launchBrowser(chromium, baseHost, resolveIp);
      const second = await inspectRoute(browser, base, spec, audit, authStorageState);
      second.attempts = [retrySummary(first), retrySummary(second)];
      results.push(second);
    } else {
      results.push(first);
    }
  }
  await browser.close();

  const failures = [
    ...results.filter((result) => !result.ok).map((result) => ({ type: "route", route: result.route, failures: result.failures })),
    ...audit.console.map((item) => ({ type: "console", ...item })),
    ...audit.pageErrors.map((item) => ({ type: "pageerror", ...item })),
  ];
  const receipt = {
    origin: base,
    generated_at: new Date().toISOString(),
    level: gateLevel,
    status: failures.length ? "fail" : "pass",
    summary: {
      routes: results.length,
      available_routes: ROUTES.length,
      failures: failures.length,
      console_issues: audit.console.length,
      page_errors: audit.pageErrors.length,
    },
    results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    routes: results.map((result) => ({
      route: result.route,
      showing: result.showing.slice(0, 3),
      filters: result.filters,
      selects: result.selects,
      sortable: result.sortable,
      interactions: result.interactions,
      ok: result.ok,
    })),
    receipt: receiptPath,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
