#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const jsonPath = path.join(outputDir, "swfipn-sitemap-data-map-latest.json");
const csvPath = path.join(outputDir, "swfipn-sitemap-data-map-latest.csv");
const mermaidPath = path.join(outputDir, "swfipn-sitemap-data-map-latest.mmd");
const routeTimeoutMs = Number(process.env.SWFIPN_SITEMAP_ROUTE_TIMEOUT_MS || 90_000);
const internalRouteTimeoutMs = Number(process.env.SWFIPN_SITEMAP_INTERNAL_ROUTE_TIMEOUT_MS || 15_000);

const ROUTE_READY_TEXT = {
  "/": "KPI CARDS",
  "/mandates/": "CalPERS Issues RFP",
  "/people/": "Showing 5 of",
  "/profiles/": "Entity Name",
  "/deals/": "Showing 5 of",
  "/comparisons/": "Peer Comparisons",
  "/reports/": "Reports Intelligence",
  "/intelligence/": "Intelligence",
  "/research/": "Research / News",
  "/search/": "Institution, Person, Strategy",
  "/source/": "Source Detail",
  "/provenance/": "Source References",
  "/transactions/": "Showing 5 of",
};

const SEARCH_VARIANTS = [
  { route: "/search/?q=Prem", ready: "Showing 5 of" },
  { route: "/search/?q=Real%20Estate", ready: "Showing 5 of" },
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

function discoverRoutes() {
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

function appRouteFromUrl(base, href) {
  try {
    const parsed = new URL(href);
    const root = new URL(base);
    if (parsed.origin !== root.origin) return null;
    const basePath = root.pathname.replace(/\/$/, "");
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

function isInsideBase(base, href) {
  const parsed = new URL(href);
  const root = new URL(base);
  const basePath = root.pathname.replace(/\/$/, "");
  return parsed.origin === root.origin && parsed.pathname.startsWith(basePath || "/");
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

function apiKeyFromUrl(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function isBackendUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

function extractRows(packet) {
  const rows = [];
  const data = packet && typeof packet === "object" ? packet.data : null;
  const sources = [
    ["rows", data?.rows],
    ["results", data?.results],
    ["facets.sectors", data?.facets?.sectors],
    ["facets.regions", data?.facets?.regions],
    ["facets.industries", data?.facets?.industries],
    ["ranges", data?.ranges],
  ];
  for (const [key, value] of sources) {
    if (!Array.isArray(value)) continue;
    value.forEach((row, index) => {
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push({ key, index, row });
    });
  }
  return rows;
}

function sourceHref(row) {
  for (const key of ["source_url", "swfi_url", "url"]) {
    const value = String(row?.[key] || "");
    if (value.startsWith("http://") || value.startsWith("https://")) return normalizeSwfiUrl(value);
  }
  for (const key of ["deal_source_urls", "source_urls"]) {
    const values = Array.isArray(row?.[key]) ? row[key] : [];
    const first = values.map((value) => String(value || "")).find((value) => value.startsWith("http://") || value.startsWith("https://"));
    if (first) return normalizeSwfiUrl(first);
  }
  return "";
}

function normalizeSwfiUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "cms.swfi.com") {
      parsed.hostname = "www.swfi.com";
      return parsed.toString();
    }
  } catch {
    return value;
  }
  return value;
}

function labelCandidates(row) {
  return ["title", "name", "institution", "entity_name", "investor", "investor_a", "investor_b"]
    .map((key) => String(row?.[key] || "").trim())
    .filter(Boolean)
    .filter((value) => !/^(not disclosed|source gap|loading)$/i.test(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function renderCsv(dataPoints) {
  const headers = ["route", "kind", "section", "table_index", "row_index", "column", "text", "href", "source_api", "source_href", "status"];
  const lines = [headers.join(",")];
  for (const point of dataPoints) {
    lines.push(headers.map((header) => csvEscape(point[header] || "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function routeId(route) {
  return route.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";
}

function renderMermaid(receipt) {
  const lines = ["flowchart LR"];
  for (const page of receipt.pages) {
    const id = `r_${routeId(page.route)}`;
    lines.push(`  ${id}["${page.route}\\n${page.tables.length} tables / ${page.links.length} links"]`);
  }
  for (const edge of receipt.route_edges) {
    lines.push(`  r_${routeId(edge.from)} --> r_${routeId(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function waitForReady(page, ready) {
  if (!ready) return true;
  return page.waitForFunction((text) => document.body?.innerText.includes(text), ready, { timeout: 75_000 })
    .then(() => true)
    .catch(() => false);
}

async function waitForRenderedSettle(page) {
  await page.waitForFunction(
    () => {
      const body = document.body?.innerText || "";
      if (/Bad gateway|Error code 50[0234]/i.test(body)) return false;
      if (body.includes("Loading")) return false;
      const hasRows = Array.from(document.querySelectorAll("tbody tr")).some((row) => row.innerText.trim() && !/Loading/i.test(row.innerText));
      const hasSourceGapPanel = body.includes("Source gap");
      const hasDashboardRows = body.includes("KPI CARDS")
        && body.includes("Top Active Allocators")
        && body.includes("Newest Transactions")
        && body.includes("TOP 10 SECTORS");
      const hasNoTable = !document.querySelector("table") && body.trim().length > 0;
      return hasRows || hasDashboardRows || hasSourceGapPanel || hasNoTable;
    },
    null,
    { timeout: 120_000 },
  );
}

async function crawlRoute(browser, base, routeSpec, audit) {
  const route = typeof routeSpec === "string" ? routeSpec : routeSpec.route;
  const ready = typeof routeSpec === "string" ? ROUTE_READY_TEXT[route] : routeSpec.ready;
  const packets = new Map();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.on("console", (msg) => {
    if (["error", "warning", "warn"].includes(msg.type())) audit.console.push({ route, type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => audit.page_errors.push({ route, text: err.message }));
  page.on("response", async (response) => {
    const url = response.url();
    if (!isBackendUrl(url) || response.request().method() !== "GET") return;
    const key = apiKeyFromUrl(url);
    const entry = packets.get(key) || { key, url, http_status: response.status(), packet_status: null, source_gap: null, rows: [], failures: [] };
    entry.http_status = response.status();
    try {
      const json = await response.json();
      entry.packet_status = json?.status || null;
      entry.state = json?.state || null;
      entry.result_qualifier = json?.result_qualifier || null;
      entry.source_gap = Boolean(json?.source_gap);
      entry.source_gap_reason = json?.source_gap_reason || null;
      entry.rows = extractRows(json).map((item) => ({
        key: item.key,
        index: item.index,
        labels: labelCandidates(item.row),
        source_href: sourceHref(item.row),
        source_record_id: item.row.source_record_id || item.row.id || item.row.entity_id || null,
      }));
    } catch (error) {
      entry.failures.push(`json:${error.message}`);
    }
    packets.set(key, entry);
  });

  const url = routeUrl(base, route);
  const result = {
    route,
    url,
    status: null,
    ok: true,
    failures: [],
    body_first: [],
    source_gap_count: 0,
    loading_count: 0,
    links: [],
    forms: [],
    selects: [],
    tables: [],
    data_points: [],
    backend_packets: [],
    missing_source_links: [],
    external_links: [],
  };

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result.status = response?.status() || null;
    const finalUrl = new URL(page.url());
    const baseUrl = new URL(base);
    if (finalUrl.origin !== baseUrl.origin || !finalUrl.pathname.startsWith(baseUrl.pathname.replace(/\/$/, ""))) {
      result.failures.push(`wrong_host_or_base:${page.url()}`);
    }
    if (ready && !(await waitForReady(page, ready))) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await waitForReady(page, ready);
    }
    await waitForRenderedSettle(page);
    await page.waitForTimeout(500);

    const dom = await page.evaluate(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const text = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll?.("script,style,select").forEach((element) => element.remove());
      const bodyWithoutSelects = (bodyClone.innerText || bodyClone.textContent || "");
      const anchorOf = (el) => {
        const anchor = el.matches?.("a[href]") ? el : el.querySelector?.("a[href]");
        return anchor ? { href: anchor.href, text: text(anchor), sourceHref: anchor.getAttribute("data-source-state") || "" } : null;
      };
      const tables = Array.from(document.querySelectorAll("table")).filter(visible).map((table, tableIndex) => {
        const headers = Array.from(table.querySelectorAll("thead th")).map(text);
        const rows = Array.from(table.querySelectorAll("tbody tr")).filter(visible).map((tr, rowIndex) => {
          const cells = Array.from(tr.querySelectorAll("td")).map((td, colIndex) => ({
            table_index: tableIndex,
            row_index: rowIndex,
            column_index: colIndex,
            column: headers[colIndex] || "",
            text: text(td),
            href: anchorOf(td)?.href || "",
            source_href: anchorOf(td)?.sourceHref || "",
          }));
          return { row_index: rowIndex, cells };
        });
        return { table_index: tableIndex, headers, rows };
      });
      return {
        body_first: bodyWithoutSelects.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40),
        source_gap_count: (document.body.innerText.match(/Source gap/g) || []).length,
        loading_count: (document.body.innerText.match(/Loading/g) || []).length,
        links: Array.from(document.querySelectorAll("a[href]")).filter(visible).map((a, index) => ({
          index,
          text: text(a),
          href: a.href,
          raw: a.getAttribute("href") || "",
          source_href: a.getAttribute("data-source-state") || "",
        })),
        forms: Array.from(document.querySelectorAll("form")).filter(visible).map((form, index) => ({
          index,
          action: form.action,
          method: form.method,
          text: text(form),
          inputs: Array.from(form.querySelectorAll("input, textarea")).map((input) => ({
            id: input.id,
            name: input.getAttribute("name") || "",
            type: input.getAttribute("type") || "",
            placeholder: input.getAttribute("placeholder") || "",
          })),
        })),
        selects: Array.from(document.querySelectorAll("select")).filter(visible).map((select, index) => ({
          index,
          id: select.id,
          name: select.getAttribute("name") || "",
          option_count: select.querySelectorAll("option").length,
          options: Array.from(select.querySelectorAll("option")).slice(0, 100).map((option) => option.textContent?.trim() || ""),
        })),
        tables,
      };
    });

    Object.assign(result, dom);
    result.backend_packets = [...packets.values()].sort((a, b) => a.key.localeCompare(b.key));
    const routeLinks = result.links.map((link) => ({ ...link, app_route: appRouteFromUrl(base, link.href) }));
    result.links = routeLinks;
    result.external_links = routeLinks
      .filter((link) => !link.app_route && isHttpUrl(link.href))
      .map((link) => classifyVisibleHttpLink(base, link))
      .filter(Boolean);

    for (const link of result.links) {
      const externalFailure = result.external_links.find((external) => external.href === link.href && external.index === link.index);
      result.data_points.push({
        route,
        kind: "link",
        section: "",
        table_index: "",
        row_index: "",
        column: "",
        text: link.text,
        href: link.href,
        source_api: "",
        source_href: link.source_href || "",
        status: link.app_route ? "internal_link" : externalFailure ? "external_link_failure" : "non_http_link",
      });
    }

    for (const table of result.tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          if (!cell.text) continue;
          result.data_points.push({
            route,
            kind: "table_cell",
            section: "",
            table_index: table.table_index,
            row_index: cell.row_index,
            column: cell.column,
            text: cell.text,
            href: cell.href,
            source_href: cell.source_href,
            source_api: "",
            status: cell.href ? "linked" : "plain",
          });
        }
      }
    }

    const hrefSet = new Set([
      ...result.links.map((link) => link.href),
      ...result.links.map((link) => link.source_href).filter(Boolean),
      ...result.data_points.map((point) => point.href).filter(Boolean),
      ...result.data_points.map((point) => point.source_href).filter(Boolean),
    ]);
    const bodyText = result.body_first.join(" ");
    for (const packet of result.backend_packets) {
      for (const sourceRow of packet.rows) {
        if (!sourceRow.source_href) continue;
        const renderedLabel = sourceRow.labels.find((label) => bodyText.includes(label) || result.data_points.some((point) => point.text === label));
        if (!renderedLabel) continue;
        const linked = hrefSet.has(sourceRow.source_href) || result.data_points.some((point) => point.href === sourceRow.source_href);
        const point = result.data_points.find((candidate) => candidate.text === renderedLabel);
        if (point) {
          point.source_api = packet.key;
          point.source_href = sourceRow.source_href;
          point.status = linked ? "source_linked" : "source_metadata_unlinked";
        }
        if (!linked) {
          result.missing_source_links.push({
            label: renderedLabel,
            source_api: packet.key,
            source_href: sourceRow.source_href,
            source_record_id: sourceRow.source_record_id,
          });
        }
      }
    }

    if (!result.status || result.status >= 400) result.failures.push(`http_${result.status || "missing"}`);
    if (result.source_gap_count) result.failures.push(`source_gap_count_${result.source_gap_count}`);
    if (result.loading_count) result.failures.push(`loading_count_${result.loading_count}`);
    if (result.external_links.length) result.failures.push(`self_contained_external_links_${result.external_links.length}`);
    result.ok = result.failures.length === 0;
  } catch (error) {
    result.ok = false;
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

function timeoutResult(routeSpec, error) {
  const route = typeof routeSpec === "string" ? routeSpec : routeSpec.route;
  return {
    route,
    url: "",
    status: null,
    ok: false,
    failures: [`route_timeout:${error.message}`],
    body_first: [],
    source_gap_count: 0,
    loading_count: 0,
    links: [],
    forms: [],
    selects: [],
    tables: [],
    data_points: [],
    backend_packets: [],
    missing_source_links: [],
    external_links: [],
  };
}

async function crawlRouteWithTimeout(browser, base, routeSpec, audit) {
  const route = typeof routeSpec === "string" ? routeSpec : routeSpec.route;
  const timer = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${route} exceeded ${routeTimeoutMs}ms`)), routeTimeoutMs);
  });
  try {
    return await Promise.race([crawlRoute(browser, base, routeSpec, audit), timer]);
  } catch (error) {
    return timeoutResult(routeSpec, error);
  }
}

async function verifyInternalRoutes(browser, base, pages) {
  const targets = [...new Set(pages.flatMap((page) => page.links.map((link) => link.app_route).filter(Boolean)))].sort();
  const checks = [];
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 780 } });
    try {
      const response = await page.goto(routeUrl(base, target), { waitUntil: "domcontentloaded", timeout: internalRouteTimeoutMs });
      checks.push({ route: target, status: response?.status() || 0, ok: Boolean(response && response.status() < 400), error: "" });
    } catch (error) {
      checks.push({ route: target, status: 0, ok: false, error: error.message });
    } finally {
      await page.close().catch(() => {});
    }
  }
  return checks;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
  const audit = { console: [], page_errors: [] };
  const sitemapRoutes = discoverRoutes();
  const crawlTargets = [...sitemapRoutes, ...SEARCH_VARIANTS];
  const pages = [];
  for (const [index, target] of crawlTargets.entries()) {
    const route = typeof target === "string" ? target : target.route;
    console.log(`[sitemap-data-map] ${index + 1}/${crawlTargets.length} ${route}`);
    const pageResult = await crawlRouteWithTimeout(browser, base, target, audit);
    console.log(`[sitemap-data-map] ${route} ${pageResult.ok ? "ok" : `fail:${pageResult.failures.join("|")}`}`);
    pages.push(pageResult);
  }

  const routeEdges = [];
  for (const page of pages) {
    for (const link of page.links) {
      if (link.app_route) routeEdges.push({ from: page.route, to: link.app_route, text: link.text, href: link.href });
    }
  }
  const routeEdgeKeys = new Set();
  const route_edges = routeEdges.filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.text}`;
    if (routeEdgeKeys.has(key)) return false;
    routeEdgeKeys.add(key);
    return true;
  });
  const internal_route_checks = await verifyInternalRoutes(browser, base, pages);
  await browser.close();
  const data_points = pages.flatMap((page) => page.data_points);
  const missing_source_links = pages.flatMap((page) => page.missing_source_links.map((item) => ({ route: page.route, ...item })));
  const external_links = pages.flatMap((page) => page.external_links.map((item) => ({ route: page.route, ...item })));
  const source_links_checked = new Set(
    pages.flatMap((page) => page.backend_packets.flatMap((packet) => packet.rows.map((row) => row.source_href).filter(Boolean))),
  ).size;
  const wrongHostFailures = external_links.flatMap((link) => link.failures.filter((failure) => failure.startsWith("wrong_host_or_base:")));
  const failures = [
    ...pages.filter((page) => !page.ok).map((page) => ({ type: "page", route: page.route, failures: page.failures })),
    ...missing_source_links.map((item) => ({ type: "missing_source_link", route: item.route, label: item.label, source_api: item.source_api, source_href: item.source_href })),
    ...external_links.map((link) => ({ type: "external_link", route: link.route, href: link.href, text: link.text, failures: link.failures })),
    ...internal_route_checks.filter((check) => !check.ok).map((check) => ({ type: "internal_route", ...check })),
    ...audit.console.map((item) => ({ type: "console", ...item })),
    ...audit.page_errors.map((item) => ({ type: "page_error", ...item })),
  ];
  const receipt = {
    origin: base,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      sitemap_routes: sitemapRoutes.length,
      crawled_pages: pages.length,
      route_edges: route_edges.length,
      internal_route_checks: internal_route_checks.length,
      links: pages.reduce((total, page) => total + page.links.length, 0),
      forms: pages.reduce((total, page) => total + page.forms.length, 0),
      selects: pages.reduce((total, page) => total + page.selects.length, 0),
      tables: pages.reduce((total, page) => total + page.tables.length, 0),
      data_points: data_points.length,
      backend_packets: pages.reduce((total, page) => total + page.backend_packets.length, 0),
      missing_source_links: missing_source_links.length,
      self_contained_link_failures: external_links.length,
      external_links_checked: external_links.length,
      source_links_checked,
      wrong_host_failures: wrongHostFailures.length,
      failures: failures.length,
      console_issues: audit.console.length,
      page_errors: audit.page_errors.length,
    },
    sitemap_routes: sitemapRoutes,
    pages,
    route_edges,
    internal_route_checks,
    data_points,
    missing_source_links,
    external_links,
    failures,
    console_issues: audit.console,
    page_errors: audit.page_errors,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(csvPath, renderCsv(data_points));
  fs.writeFileSync(mermaidPath, renderMermaid(receipt));
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: jsonPath, csv: csvPath, graph: mermaidPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
