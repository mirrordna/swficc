#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const jsonPath = path.join(outputDir, "swfipn-public-proof-crawl-latest.json");
const mermaidPath = path.join(outputDir, "swfipn-public-proof-crawl-latest.mmd");

const SOURCE_FETCH_TIMEOUT_MS = Number(process.env.SWFIPN_SOURCE_FETCH_TIMEOUT_MS || "5000");
const ROUTE_TIMEOUT_MS = Number(process.env.SWFIPN_ROUTE_TIMEOUT_MS || "65000");
const CLICK_TIMEOUT_MS = Number(process.env.SWFIPN_CLICK_TIMEOUT_MS || "30000");
const FORM_TIMEOUT_MS = Number(process.env.SWFIPN_FORM_TIMEOUT_MS || "45000");
const PHASE_TIMEOUT_MS = Number(process.env.SWFIPN_PHASE_TIMEOUT_MS || "600000");
const DEEP_WALK_DEPTH = Number(process.env.SWFIPN_DEEP_WALK_DEPTH || "5");
const DEEP_WALK_MAX_SEEDS = Number(process.env.SWFIPN_DEEP_WALK_MAX_SEEDS || "15");
const DEEP_WALK_CONCURRENCY = Number(process.env.SWFIPN_DEEP_WALK_CONCURRENCY || "2");

const REQUIRED_NAV = [
  "/",
  "/profiles/",
  "/people/",
  "/deals/",
  "/comparisons/",
  "/transactions/",
  "/mandates/",
  "/reports/",
  "/intelligence/",
  "/research/",
  "/search/",
  "/source/",
  "/provenance/",
];

const ROUTE_READY_TEXT = {
  "/": "KPI CARDS",
  "/mandates/": "Showing 5 of",
  "/people/": "Showing 5 of",
  "/people/detail/": "Person Detail",
  "/profiles/": "Entity Name",
  "/deals/": "SWFI transaction source",
  "/comparisons/": "Peer Comparisons",
  "/reports/": "Reports Intelligence",
  "/intelligence/": "Intelligence",
  "/research/": "Research / News",
  "/search/": "Institution, Person, Strategy",
  "/source/": "Source Detail",
  "/provenance/": "Source References",
  "/transactions/": "SWFI transaction source",
};

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

function exportedRoutes() {
  const outRoot = path.join(repoRoot, "out");
  const routes = new Set(["/"]);
  const stack = [outRoot];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) stack.push(full);
        continue;
      }
      if (entry.name !== "index.html") continue;
      const rel = path.relative(outRoot, dir).replaceAll(path.sep, "/");
      if (rel && rel !== "404" && rel !== "_not-found") routes.add(`/${rel}/`);
    }
  }
  return [...routes].sort((a, b) => a.localeCompare(b));
}

function routeUrl(base, route) {
  return route === "/" ? base : new URL(route.replace(/^\//, ""), base).href;
}

function routeFromUrl(base, href) {
  try {
    const parsed = new URL(href);
    const root = new URL(base);
    const basePath = root.pathname.replace(/\/$/, "");
    if (parsed.origin !== root.origin) return null;
    if (!parsed.pathname.startsWith(basePath)) return null;
    let route = parsed.pathname.slice(basePath.length) || "/";
    if (!route.startsWith("/")) route = `/${route}`;
    if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
    if (route.startsWith("/_next/") || route.startsWith("/api/") || route.startsWith("/v1/")) return null;
    return route;
  } catch {
    return null;
  }
}

function canonicalUrl(href) {
  const parsed = new URL(href);
  let pathname = parsed.pathname;
  if (pathname !== "/" && !pathname.endsWith("/")) pathname = `${pathname}/`;
  return `${parsed.origin}${pathname}`;
}

function isInsideBase(base, href) {
  try {
    const parsed = new URL(href);
    const root = new URL(base);
    const basePath = root.pathname.replace(/\/$/, "");
    return parsed.origin === root.origin && parsed.pathname.startsWith(basePath || "/");
  } catch {
    return false;
  }
}

function isHttpUrl(href) {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function classifyVisibleHttpLink(base, link) {
  if (isInsideBase(base, link.href)) return null;
  const parsed = new URL(link.href);
  return {
    ...link,
    host: parsed.hostname,
    failures: ["visible_external_http_link", `self_contained_navigation:${link.href}`, `wrong_host_or_base:${link.href}`],
  };
}

function routeName(route) {
  return route === "/" ? "root" : route.replaceAll("/", "_").replace(/^_/, "").replace(/_$/, "");
}

function renderMermaid(receipt) {
  const lines = ["flowchart LR"];
  for (const page of receipt.pages) {
    const id = `p_${routeName(page.route)}`;
    const label = page.ok ? page.route : `${page.route} FAIL`;
    lines.push(`  ${id}["${label}"]`);
  }
  for (const edge of receipt.edges) {
    lines.push(`  p_${routeName(edge.from)} --> p_${routeName(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}

function logProgress(message) {
  console.error(`[swfipn-proof-crawl] ${message}`);
}

function writeReceipt(receipt, status = "running") {
  const failures = collectFailures(receipt);
  const summary = summarize(receipt, failures);
  const payload = {
    ...receipt,
    status,
    summary,
    failures,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(mermaidPath, renderMermaid(payload));
  return payload;
}

function summarize(receipt, failures) {
  const wrongHostFailures = [
    ...receipt.pages.flatMap((page) => page.failures.filter((failure) => failure.startsWith("wrong_host_or_base:"))),
    ...receipt.external_link_results.flatMap((item) => item.failures.filter((failure) => failure.startsWith("wrong_host_or_base:"))),
    ...receipt.redirect_results.flatMap((item) => item.failures.filter((failure) => failure.startsWith("wrong_host_or_base:"))),
  ];
  return {
    pages: receipt.pages.length,
    edges: receipt.edges.length,
    visible_internal_edges: receipt.all_click_tasks.length,
    visible_internal_links_clicked: receipt.click_results.length,
    edge_click_limit: receipt.edge_click_limit,
    forms_tested: receipt.form_results.length,
    redirect_checks: receipt.redirect_results.length,
    self_contained_link_failures: receipt.external_link_results.filter((item) => !item.ok).length,
    external_links_checked: receipt.external_link_results.length,
    source_links_checked: receipt.pages.reduce((total, page) => total + page.source_links.length, 0),
    deep_walks_tested: receipt.deep_walk_results.length,
    deep_hops_tested: receipt.deep_walk_results.reduce((total, item) => total + item.hops.length, 0),
    deep_walk_depth: receipt.deep_walk_depth,
    wrong_host_failures: wrongHostFailures.length,
    profile_dropdown_count: receipt.profiles_list_result?.dropdown_count ?? null,
    failures: failures.length,
    console_issues: receipt.console_issues.length,
    page_errors: receipt.page_errors.length,
    progress_events: receipt.progress.length,
  };
}

function collectFailures(receipt) {
  return [
    ...receipt.pages.filter((page) => !page.ok).map((page) => ({ type: "page", route: page.route, failures: page.failures })),
    ...receipt.click_results.filter((item) => !item.ok).map((item) => ({ type: "click", from: item.from, to: item.to, text: item.text, href: item.href, failures: item.failures })),
    ...receipt.form_results.filter((item) => !item.ok).map((item) => ({ type: "form", name: item.name, failures: item.failures })),
    ...receipt.redirect_results.filter((item) => !item.ok).map((item) => ({ type: "redirect", name: item.name, failures: item.failures, final_url: item.final_url })),
    ...receipt.external_link_results.filter((item) => !item.ok).map((item) => ({ type: "external_link", route: item.route, href: item.href, status: item.status, failures: item.failures })),
    ...(receipt.profiles_list_result && !receipt.profiles_list_result.ok ? [{ type: "profiles_list", failures: receipt.profiles_list_result.failures }] : []),
    ...receipt.deep_walk_results.filter((item) => !item.ok).map((item) => ({ type: "deep_walk", seed: item.seed, failures: item.failures, hops: item.hops })),
    ...receipt.console_issues.map((item) => ({ type: "console", ...item })),
    ...receipt.page_errors.map((item) => ({ type: "page_error", ...item })),
  ];
}

function pushProgress(receipt, phase, item, status, detail = "") {
  const event = { at: new Date().toISOString(), phase, item, status, detail };
  receipt.progress.push(event);
  logProgress(`${phase}:${item} ${status}${detail ? ` ${detail}` : ""}`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = SOURCE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function newPage(browser, audit) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(ROUTE_TIMEOUT_MS);
  page.on("console", (msg) => {
    if (["error", "warning", "warn"].includes(msg.type())) {
      audit.console.push({ url: page.url(), type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => audit.pageErrors.push({ url: page.url(), text: err.message }));
  return page;
}

async function waitForReady(page, route, timeout = 30_000) {
  const readyText = ROUTE_READY_TEXT[route];
  if (!readyText) return true;
  return page.waitForFunction((text) => document.body?.innerText.includes(text), readyText, { timeout })
    .then(() => true)
    .catch(() => false);
}

async function runWithDeadline(label, timeoutMs, fn) {
  let timer;
  return Promise.race([
    fn(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function inventoryRoute(browser, base, route, audit) {
  const page = await newPage(browser, audit);
  const result = {
    route,
    url: routeUrl(base, route),
    status: null,
    ok: true,
    failures: [],
    source_gap_count: 0,
    loading_count: 0,
    nav_missing: [],
    link_count: 0,
    final_url: "",
    body_first: [],
    forms: [],
    links: [],
    source_links: [],
    external_links: [],
  };
  try {
    await runWithDeadline(`inventory:${route}`, ROUTE_TIMEOUT_MS + 15_000, async () => {
      const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
      result.status = response?.status() || null;
      result.final_url = page.url();
      if (!isInsideBase(base, result.final_url)) result.failures.push(`wrong_host_or_base:${result.final_url}`);
      await page.waitForTimeout(750);
      if (!(await waitForReady(page, route, 22_000))) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS }).catch(() => {});
        await waitForReady(page, route, 18_000);
      }
      await page.waitForFunction(() => !document.body?.innerText.includes("Loading"), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(250);
      const data = await page.evaluate(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const body = document.body.innerText || "";
        return {
          body_first: body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 32),
          source_gap_count: (body.match(/Source gap/g) || []).length,
          loading_count: (body.match(/Loading/g) || []).length,
          links: Array.from(document.querySelectorAll("a[href]"))
            .filter(visible)
            .map((link, index) => ({
              index,
              text: link.innerText.trim().replace(/\s+/g, " "),
              href: link.href,
              raw: link.getAttribute("href") || "",
              source_href: link.getAttribute("data-source-state") || "",
            })),
          forms: Array.from(document.querySelectorAll("form")).map((form, index) => ({
            index,
            action: form.action,
            method: form.method,
            text: form.innerText.trim().replace(/\s+/g, " "),
            inputs: Array.from(form.querySelectorAll("input, select, textarea")).map((input) => ({
              tag: input.tagName.toLowerCase(),
              id: input.id,
              name: input.getAttribute("name") || "",
              type: input.getAttribute("type") || "",
              placeholder: input.getAttribute("placeholder") || "",
            })),
          })),
        };
      });
      Object.assign(result, data);
      const normalizedLinks = result.links.map((link) => ({ ...link, route: routeFromUrl(base, link.href) }));
      result.external_links = normalizedLinks
        .filter((link) => !link.route && isHttpUrl(link.href))
        .map((link) => classifyVisibleHttpLink(base, link))
        .filter(Boolean);
      result.source_links = normalizedLinks.filter((link) => link.source_href || link.href.includes("/source/?url="));
      result.links = normalizedLinks.filter((link) => link.route);
      result.link_count = result.links.length;
      const linkedRoutes = new Set(result.links.map((link) => link.route));
      result.nav_missing = REQUIRED_NAV.filter((target) => !linkedRoutes.has(target));
      if (!result.status || result.status >= 400) result.failures.push(`http_${result.status || "missing"}`);
      if (!result.body_first.length || result.body_first.join(" ").includes("404:")) result.failures.push("blank_or_404_body");
      if (result.source_gap_count > 0) result.failures.push(`source_gap_count_${result.source_gap_count}`);
      if (result.loading_count > 0) result.failures.push(`loading_count_${result.loading_count}`);
      if (route !== "/" && result.nav_missing.length) result.failures.push(`missing_nav:${result.nav_missing.join(",")}`);
      if (result.external_links.length) result.failures.push(`self_contained_external_links_${result.external_links.length}`);
    });
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function clickLink(browser, base, fromRoute, link, audit) {
  const page = await newPage(browser, audit);
  const expected = canonicalUrl(link.href);
  const result = { from: fromRoute, to: link.route, text: link.text, href: link.href, ok: true, failures: [], final_url: "" };
  try {
    await runWithDeadline(`click:${fromRoute}->${link.route}`, CLICK_TIMEOUT_MS, async () => {
      await page.goto(routeUrl(base, fromRoute), { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
      await waitForReady(page, fromRoute, 18_000);
      await page.waitForFunction(() => !document.body?.innerText.includes("Loading"), null, { timeout: 18_000 }).catch(() => {});
      await page.waitForFunction((target) => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const root = new URL(target.base);
        const basePath = root.pathname.replace(/\/$/, "");
        const routeFromHref = (href) => {
          try {
            const parsed = new URL(href);
            if (parsed.origin !== root.origin) return null;
            if (!parsed.pathname.startsWith(basePath)) return null;
            let route = parsed.pathname.slice(basePath.length) || "/";
            if (!route.startsWith("/")) route = `/${route}`;
            if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
            if (route.startsWith("/_next/") || route.startsWith("/api/") || route.startsWith("/v1/")) return null;
            return route;
          } catch {
            return null;
          }
        };
        const textOf = (candidate) => candidate.innerText.trim().replace(/\s+/g, " ");
        return Array.from(document.querySelectorAll("a[href]"))
          .filter(visible)
          .some((candidate) => candidate.href === target.href || (routeFromHref(candidate.href) === target.route && (!target.text || textOf(candidate) === target.text || textOf(candidate))));
      }, { href: link.href, text: link.text, route: link.route, base }, { timeout: 18_000 }).catch(() => {});
      const clicked = await page.evaluate((target) => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const root = new URL(target.base);
        const basePath = root.pathname.replace(/\/$/, "");
        const routeFromHref = (href) => {
          try {
            const parsed = new URL(href);
            if (parsed.origin !== root.origin) return null;
            if (!parsed.pathname.startsWith(basePath)) return null;
            let route = parsed.pathname.slice(basePath.length) || "/";
            if (!route.startsWith("/")) route = `/${route}`;
            if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
            if (route.startsWith("/_next/") || route.startsWith("/api/") || route.startsWith("/v1/")) return null;
            return route;
          } catch {
            return null;
          }
        };
        const textOf = (candidate) => candidate.innerText.trim().replace(/\s+/g, " ");
        const anchors = Array.from(document.querySelectorAll("a[href]")).filter(visible);
        const hrefMatches = anchors.filter((candidate) => candidate.href === target.href);
        const routeMatches = anchors.filter((candidate) => routeFromHref(candidate.href) === target.route);
        const exact = hrefMatches.find((candidate) => textOf(candidate) === target.text)
          || routeMatches.find((candidate) => textOf(candidate) === target.text)
          || hrefMatches[0]
          || routeMatches[0];
        if (!exact) return false;
        exact.click();
        return true;
      }, { href: link.href, text: link.text, route: link.route, base });
      if (!clicked) result.failures.push("click_target_not_found");
      await page.waitForFunction((target) => {
        const parsed = new URL(location.href);
        let pathname = parsed.pathname;
        if (pathname !== "/" && !pathname.endsWith("/")) pathname = `${pathname}/`;
        return `${parsed.origin}${pathname}` === target;
      }, expected, { timeout: 8_000 }).catch(() => {});
      result.final_url = page.url();
      if (canonicalUrl(result.final_url) !== expected) {
        await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS }).catch(() => {});
        result.final_url = page.url();
      }
      if (canonicalUrl(result.final_url) !== expected) result.failures.push(`wrong_destination:${canonicalUrl(result.final_url)}!=${expected}`);
      await waitForReady(page, link.route, 15_000);
      const bodyOk = await page.evaluate(() => document.body?.innerText.length > 0 && !document.body.innerText.includes("404:")).catch(() => false);
      if (!bodyOk) result.failures.push("blank_or_404_destination");
    });
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function proofSearch(browser, base, audit) {
  const cases = [
    { name: "dashboard_search_prem", route: "/", selector: "#dashboard-search", query: "Prem", expected: "Prem" },
    { name: "search_page_submit_real_estate", route: "/search/", selector: "#swfi-search-input", query: "Real Estate", expected: "Real Estate" },
    { name: "search_direct_url_prem", route: "/search/?q=Prem", selector: null, query: "Prem", expected: "Prem" },
  ];
  const tests = [];
  for (const item of cases) {
    const page = await newPage(browser, audit);
    const result = { name: item.name, ok: true, failures: [], final_url: "", source_gap_count: 0, body_first: [] };
    try {
      await runWithDeadline(`form:${item.name}`, FORM_TIMEOUT_MS, async () => {
        await page.goto(routeUrl(base, item.route), { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
        if (item.selector) {
          await page.locator(item.selector).fill(item.query, { timeout: 10_000 });
          await page.locator(item.selector).press("Enter", { timeout: 10_000 });
          await page.waitForURL("**/swficc/search/**", { timeout: 15_000 }).catch(() => {});
        }
        await page.waitForFunction((expected) => document.body.innerText.includes(expected), item.expected, { timeout: 30_000 });
        result.final_url = page.url();
        const body = await page.evaluate(() => document.body.innerText);
        result.source_gap_count = (body.match(/Source gap/g) || []).length;
        result.body_first = body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 24);
        if (new URL(result.final_url).searchParams.get("q") !== item.query) result.failures.push("query_not_in_url");
        if (result.source_gap_count) result.failures.push(`source_gap_count_${result.source_gap_count}`);
      });
    } catch (error) {
      result.failures.push(error.message);
      result.final_url = page.url();
      result.body_first = await page.evaluate(() => document.body.innerText.split("\n").slice(0, 24)).catch(() => []);
    } finally {
      await page.close().catch(() => {});
    }
    result.ok = result.failures.length === 0;
    tests.push(result);
  }
  return tests;
}

async function checkExternalLink(link) {
  const result = { href: link.href, text: link.text, route: link.route, ok: true, status: 0, final_url: "", failures: [] };
  result.final_url = link.href;
  if (!link.source_provenance_check) {
    result.failures.push(...(link.failures || ["visible_external_http_link"]));
    result.ok = false;
    return result;
  }
  try {
    let response = await fetchWithTimeout(link.href, { method: "HEAD", redirect: "follow" }).catch(() => null);
    if (!response || response.status === 405) response = await fetchWithTimeout(link.href, { method: "GET", redirect: "follow" }).catch(() => null);
    result.status = response?.status || 0;
    result.final_url = response?.url || link.href;
    result.provenance_status = !response ? "source_fetch_failed" : response.status >= 400 ? `source_http_${response.status}` : "source_reachable";
  } catch (error) {
    result.provenance_status = error.name === "AbortError" ? "source_fetch_timeout" : `source_fetch_error:${error.message}`;
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function proofExternalLinks(pages) {
  const seen = new Set();
  const links = [];
  for (const page of pages) {
    for (const link of page.external_links) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      links.push({ ...link, route: page.route });
    }
  }
  return runLimited(links, 6, checkExternalLink);
}

async function proofRedirects(browser, base, audit) {
  const root = new URL(base);
  const checks = [
    { name: "bare_host_redirects_to_swficc", url: `${root.origin}/`, expectedCanonical: canonicalUrl(base) },
    { name: "swficc_root_stays_on_host", url: base, expectedCanonical: canonicalUrl(base) },
    { name: "search_route_stays_on_host", url: new URL("search/?q=Real%20Estate", base).href, expectedCanonical: canonicalUrl(new URL("search/", base).href) },
    { name: "profiles_route_stays_on_host", url: new URL("profiles/", base).href, expectedCanonical: canonicalUrl(new URL("profiles/", base).href) },
  ];
  const results = [];
  for (const item of checks) {
    const page = await newPage(browser, audit);
    const result = { name: item.name, url: item.url, final_url: "", ok: true, failures: [] };
    try {
      await runWithDeadline(`redirect:${item.name}`, CLICK_TIMEOUT_MS, async () => {
        const response = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
        result.final_url = page.url();
        if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
        if (!isInsideBase(base, result.final_url)) result.failures.push(`wrong_host_or_base:${result.final_url}`);
        if (canonicalUrl(result.final_url) !== item.expectedCanonical) result.failures.push(`wrong_destination:${canonicalUrl(result.final_url)}!=${item.expectedCanonical}`);
        if (result.final_url.startsWith("https://activemirror.ai/")) result.failures.push("active_mirror_redirect");
      });
    } catch (error) {
      result.failures.push(error.message);
      result.final_url = page.url();
    } finally {
      await page.close().catch(() => {});
    }
    result.ok = result.failures.length === 0;
    results.push(result);
  }
  return results;
}

async function proofProfilesList(browser, base, audit) {
  const page = await newPage(browser, audit);
  const result = { name: "profiles_list", ok: true, failures: [], dropdown_count: 0, first_link: "", first_link_href: "", body_excerpt: "" };
  try {
    await runWithDeadline("profiles_list", ROUTE_TIMEOUT_MS, async () => {
      await page.goto(routeUrl(base, "/profiles/"), { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
      await page.waitForFunction(() => document.body.innerText.includes("Entity Name") && document.body.innerText.includes("AUM"), null, { timeout: 35_000 });
      await page.waitForFunction(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return Array.from(document.querySelectorAll("a[href]")).filter(visible).some((link) => {
          const href = link.getAttribute("href") || link.href || "";
          return href.includes("/profiles/detail/") || href.includes("/swficc/profiles/detail/") || href.includes("/swficc/v1/entities/");
        });
      }, null, { timeout: 30_000 }).catch(() => {});
      result.dropdown_count = await page.locator("#profile-select").count();
      if (result.dropdown_count !== 0) result.failures.push(`profile_dropdown_still_present:${result.dropdown_count}`);
      const first = page.locator('a[href*="/profiles/detail/"], a[href*="/swficc/profiles/detail/"], a[href*="/swficc/v1/entities/"]').first();
      if (await first.count()) {
        result.first_link = (await first.innerText()).trim();
        result.first_link_href = await first.getAttribute("href") || "";
        const normalizedHref = new URL(result.first_link_href, base).href;
        if (!normalizedHref.includes("/swficc/profiles/detail/") && !normalizedHref.includes("/swficc/v1/entities/")) {
          result.failures.push(`first_profile_link_not_internal_detail:${result.first_link_href}`);
        }
      } else {
        result.failures.push("missing_internal_profile_detail_link");
      }
      result.body_excerpt = (await page.locator("body").innerText()).split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20).join(" | ");
    });
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function scoreDeepCandidate(candidate, currentRoute, visitedRoutes) {
  let score = 0;
  if (candidate.route && candidate.route !== currentRoute) score += 30;
  if (/\/(profiles|transactions|mandates)\/detail\/$/.test(candidate.route)) score += 90;
  if (candidate.route === "/source/" && candidate.source_href) score += 75;
  if (["/profiles/", "/deals/", "/comparisons/", "/transactions/", "/mandates/", "/intelligence/", "/search/", "/provenance/"].includes(candidate.route)) score += 45;
  if (candidate.route === "/") score -= 15;
  if (visitedRoutes.includes(candidate.route)) score -= 25;
  if (!candidate.text) score -= 10;
  if (/source detail/i.test(candidate.text)) score += 10;
  return score;
}

function chooseDeepCandidate(candidates, currentRoute, visitedRoutes) {
  const viable = candidates.filter((candidate) => candidate.route && candidate.href);
  const preferred = viable.filter((candidate) => candidate.route !== currentRoute);
  return (preferred.length ? preferred : viable)
    .map((candidate) => ({ ...candidate, score: scoreDeepCandidate(candidate, currentRoute, visitedRoutes) }))
    .sort((a, b) => b.score - a.score || a.route.localeCompare(b.route) || a.text.localeCompare(b.text))[0];
}

async function visibleInternalLinks(page, base) {
  return page.evaluate((targetBase) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const root = new URL(targetBase);
    const basePath = root.pathname.replace(/\/$/, "");
    const routeFromHref = (href) => {
      try {
        const parsed = new URL(href);
        if (parsed.origin !== root.origin) return null;
        if (!parsed.pathname.startsWith(basePath)) return null;
        let route = parsed.pathname.slice(basePath.length) || "/";
        if (!route.startsWith("/")) route = `/${route}`;
        if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
        if (route.startsWith("/_next/") || route.startsWith("/api/") || route.startsWith("/v1/")) return null;
        return route;
      } catch {
        return null;
      }
    };
    return Array.from(document.querySelectorAll("a[href]"))
      .filter(visible)
      .map((link, index) => ({
        index,
        text: link.innerText.trim().replace(/\s+/g, " "),
        href: link.href,
        raw: link.getAttribute("href") || "",
        source_href: link.getAttribute("data-source-state") || "",
        route: routeFromHref(link.href),
      }))
      .filter((link) => link.route);
  }, base);
}

async function clickDeepCandidate(page, candidate) {
  return page.evaluate((target) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const textOf = (candidateLink) => candidateLink.innerText.trim().replace(/\s+/g, " ");
    const matches = Array.from(document.querySelectorAll("a[href]"))
      .filter(visible)
      .filter((candidateLink) => candidateLink.href === target.href);
    const exact = matches.find((candidateLink) => textOf(candidateLink) === target.text) || matches[0];
    if (!exact) return false;
    exact.click();
    return true;
  }, { href: candidate.href, text: candidate.text });
}

async function deepWalk(browser, base, seedRoute, audit) {
  const page = await newPage(browser, audit);
  const result = { seed: seedRoute, ok: true, failures: [], hops: [] };
  const visitedRoutes = [seedRoute];
  let currentRoute = seedRoute;
  try {
    await runWithDeadline(`deep_walk:${seedRoute}`, Math.max(CLICK_TIMEOUT_MS, DEEP_WALK_DEPTH * 16_000), async () => {
      await page.goto(routeUrl(base, seedRoute), { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
      for (let depth = 1; depth <= DEEP_WALK_DEPTH; depth += 1) {
        await waitForReady(page, currentRoute, 18_000);
        await page.waitForFunction(() => !document.body?.innerText.includes("Loading"), null, { timeout: 18_000 }).catch(() => {});
        await page.waitForTimeout(200);
        const links = await visibleInternalLinks(page, base);
        const candidate = chooseDeepCandidate(links, currentRoute, visitedRoutes);
        if (!candidate) {
          result.failures.push(`hop_${depth}_no_visible_internal_link`);
          break;
        }
        const before = page.url();
        const clicked = await clickDeepCandidate(page, candidate);
        if (!clicked) {
          result.failures.push(`hop_${depth}_click_target_not_found:${candidate.href}`);
          break;
        }
        if (candidate.route !== currentRoute || canonicalUrl(candidate.href) !== canonicalUrl(before)) {
          await page.waitForFunction((target) => {
            const parsed = new URL(location.href);
            let pathname = parsed.pathname;
            if (pathname !== "/" && !pathname.endsWith("/")) pathname = `${pathname}/`;
            return `${parsed.origin}${pathname}` === target;
          }, canonicalUrl(candidate.href), { timeout: 10_000 }).catch(() => {});
        }
        await page.waitForTimeout(300);
        const finalUrl = page.url();
        const finalRoute = routeFromUrl(base, finalUrl);
        const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        const hop = {
          depth,
          from: currentRoute,
          to: finalRoute || "",
          text: candidate.text,
          href: candidate.href,
          final_url: finalUrl,
          body_length: body.length,
        };
        result.hops.push(hop);
        if (!isInsideBase(base, finalUrl)) result.failures.push(`hop_${depth}_wrong_host_or_base:${finalUrl}`);
        if (!finalRoute) result.failures.push(`hop_${depth}_not_internal_route:${finalUrl}`);
        if (!body.length || body.includes("404:")) result.failures.push(`hop_${depth}_blank_or_404`);
        if ((body.match(/Source gap/g) || []).length) result.failures.push(`hop_${depth}_source_gap`);
        currentRoute = finalRoute || candidate.route;
        visitedRoutes.push(currentRoute);
        if (result.failures.length) break;
      }
    });
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  if (result.hops.length < DEEP_WALK_DEPTH) result.failures.push(`deep_walk_incomplete:${result.hops.length}/${DEEP_WALK_DEPTH}`);
  result.ok = result.failures.length === 0;
  return result;
}

async function proofDeepWalks(browser, base, routes, audit) {
  const seeds = routes.slice(0, DEEP_WALK_MAX_SEEDS);
  return runLimited(seeds, DEEP_WALK_CONCURRENCY, (route) => deepWalk(browser, base, route, audit));
}

async function runLimited(items, limit, fn, onEach = async () => {}) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
      await onEach(results[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runPhase(receipt, phase, work) {
  pushProgress(receipt, phase, "phase", "start");
  writeReceipt(receipt);
  try {
    await runWithDeadline(`phase:${phase}`, PHASE_TIMEOUT_MS, work);
    pushProgress(receipt, phase, "phase", "done");
  } catch (error) {
    receipt.phase_failures.push({ phase, error: error.message });
    pushProgress(receipt, phase, "phase", "fail", error.message);
  }
  writeReceipt(receipt);
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const audit = { console: [], pageErrors: [] };
  const receipt = {
    schema_version: "swfipn.public_proof_crawl.v2",
    origin: base,
    generated_at: new Date().toISOString(),
    pages: [],
    edges: [],
    all_click_tasks: [],
    edge_click_limit: Number(process.env.SWFIPN_MAX_EDGE_CLICKS || "24"),
    click_results: [],
    form_results: [],
    redirect_results: [],
    external_link_results: [],
    profiles_list_result: null,
    deep_walk_depth: DEEP_WALK_DEPTH,
    deep_walk_results: [],
    phase_failures: [],
    progress: [],
    console_issues: audit.console,
    page_errors: audit.pageErrors,
  };
  writeReceipt(receipt);

  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });

  try {
    const routes = exportedRoutes();
    await runPhase(receipt, "inventory", async () => {
      for (const route of routes) {
        pushProgress(receipt, "inventory", route, "start");
        const pageResult = await inventoryRoute(browser, base, route, audit);
        receipt.pages.push(pageResult);
        pushProgress(receipt, "inventory", route, pageResult.ok ? "done" : "fail", pageResult.failures.join(";"));
        writeReceipt(receipt);
      }
    });

    const clickSeen = new Set();
    for (const page of receipt.pages) {
      for (const link of page.links) {
        if (link.route === page.route) continue;
        const key = `${page.route}|${link.route}`;
        if (clickSeen.has(key)) continue;
        clickSeen.add(key);
        receipt.all_click_tasks.push({ page: { route: page.route }, link });
      }
    }
    receipt.edges = [...new Set(receipt.pages.flatMap((page) => page.links.map((link) => JSON.stringify({ from: page.route, to: link.route }))))].map((edge) => JSON.parse(edge));
    const clickTasks = receipt.all_click_tasks
      .sort((a, b) => {
        if (a.page.route === "/" && b.page.route !== "/") return -1;
        if (a.page.route !== "/" && b.page.route === "/") return 1;
        return `${a.page.route}${a.link.route}`.localeCompare(`${b.page.route}${b.link.route}`);
      })
      .slice(0, receipt.edge_click_limit);

    await runPhase(receipt, "clicks", async () => {
      receipt.click_results = await runLimited(
        clickTasks,
        Number(process.env.SWFIPN_CLICK_CONCURRENCY || "3"),
        ({ page, link }) => clickLink(browser, base, page.route, link, audit),
        async (result) => pushProgress(receipt, "clicks", `${result.from}->${result.to}`, result.ok ? "done" : "fail", result.failures.join(";")),
      );
    });

    await runPhase(receipt, "forms", async () => {
      receipt.form_results = await proofSearch(browser, base, audit);
      for (const result of receipt.form_results) pushProgress(receipt, "forms", result.name, result.ok ? "done" : "fail", result.failures.join(";"));
    });

    await runPhase(receipt, "redirects", async () => {
      receipt.redirect_results = await proofRedirects(browser, base, audit);
      for (const result of receipt.redirect_results) pushProgress(receipt, "redirects", result.name, result.ok ? "done" : "fail", result.failures.join(";"));
    });

    await runPhase(receipt, "profiles", async () => {
      receipt.profiles_list_result = await proofProfilesList(browser, base, audit);
      pushProgress(receipt, "profiles", "profiles_list", receipt.profiles_list_result.ok ? "done" : "fail", receipt.profiles_list_result.failures.join(";"));
    });

    await runPhase(receipt, "deep_walks", async () => {
      receipt.deep_walk_results = await proofDeepWalks(browser, base, routes, audit);
      for (const result of receipt.deep_walk_results) {
        pushProgress(receipt, "deep_walks", result.seed, result.ok ? "done" : "fail", result.failures.join(";"));
      }
    });

    await runPhase(receipt, "external_links", async () => {
      receipt.external_link_results = await proofExternalLinks(receipt.pages);
      for (const result of receipt.external_link_results) pushProgress(receipt, "external_links", result.href, result.ok ? "done" : "fail", result.failures.join(";"));
    });
  } finally {
    await browser.close().catch(() => {});
  }

  if (receipt.phase_failures.length) {
    for (const item of receipt.phase_failures) {
      receipt.progress.push({ at: new Date().toISOString(), phase: item.phase, item: "phase_failure", status: "fail", detail: item.error });
    }
  }
  const finalReceipt = writeReceipt(receipt, "complete");
  finalReceipt.status = finalReceipt.failures.length || receipt.phase_failures.length ? "fail" : "pass";
  fs.writeFileSync(jsonPath, `${JSON.stringify(finalReceipt, null, 2)}\n`);
  fs.writeFileSync(mermaidPath, renderMermaid(finalReceipt));
  console.log(JSON.stringify({ status: finalReceipt.status, summary: finalReceipt.summary, receipt: jsonPath, graph: mermaidPath }, null, 2));
  if (finalReceipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const failure = { schema_version: "swfipn.public_proof_crawl.v2", status: "fail", error: error.message, generated_at: new Date().toISOString() };
  fs.writeFileSync(jsonPath, `${JSON.stringify(failure, null, 2)}\n`);
  fs.writeFileSync(mermaidPath, "flowchart LR\n  failed[\"crawler failed before route inventory\"]\n");
  console.error(error);
  process.exit(1);
});
