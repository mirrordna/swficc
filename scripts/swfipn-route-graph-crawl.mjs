#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const jsonPath = path.join(outputDir, "swfipn-route-graph-latest.json");
const mermaidPath = path.join(outputDir, "swfipn-route-graph-latest.mmd");

const STATIC_PREFIXES = [
  "/_next/",
  "/__next",
  "/favicon",
  "/robots.txt",
  "/sitemap",
];

function loadPlaywright() {
  const roots = [
    repoRoot,
    "/Users/mirror-pro/repos/SWFI2.0-final-frontend",
    "/Users/mirror-pro/repos/SWFI2.0-final",
  ];
  for (const root of roots) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) {
      return createRequire(marker)("playwright");
    }
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeBase(input) {
  const value = input || "http://127.0.0.1:8353/swficc/";
  return value.endsWith("/") ? value : `${value}/`;
}

function pageKeyFromUrl(url, base) {
  const parsed = new URL(url);
  const basePath = new URL(base).pathname.replace(/\/$/, "");
  let pathname = parsed.pathname;
  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname !== "/" && !pathname.endsWith("/")) pathname = `${pathname}/`;
  return pathname;
}

function urlForPageKey(base, key) {
  if (key === "/") return base;
  return new URL(key.replace(/^\//, ""), base).href;
}

function isStaticPath(pathname) {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAppPageUrl(url, base) {
  try {
    const parsed = new URL(url);
    const root = new URL(base);
    if (parsed.origin !== root.origin) return false;
    if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/v1/")) return false;
    if (isStaticPath(parsed.pathname)) return false;
    const basePath = root.pathname.replace(/\/$/, "");
    return parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

function isBackendUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

function apiKeyFromUrl(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function nodeId(prefix, key) {
  return `${prefix}_${Buffer.from(key).toString("base64url").replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function mermaidLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderMermaid(graph) {
  const lines = ["flowchart LR"];
  for (const page of graph.pages) {
    const id = nodeId("page", page.path);
    const label = page.ok ? page.path : `${page.path} FAIL`;
    lines.push(`  ${id}["${mermaidLabel(label)}"]`);
  }
  for (const api of graph.apis) {
    const id = nodeId("api", api.key);
    const status = api.packet_status || api.http_status || "unread";
    lines.push(`  ${id}(("${mermaidLabel(`${api.key}\\n${status}`)}"))`);
  }
  for (const edge of graph.edges) {
    const from = nodeId(edge.from_type, edge.from);
    const to = nodeId(edge.to_type, edge.to);
    lines.push(`  ${from} --> ${to}`);
  }
  return `${lines.join("\n")}\n`;
}

function discoverExportedRoutes() {
  const outRoot = path.join(repoRoot, "out");
  if (!fs.existsSync(outRoot)) return ["/"];
  const routes = new Set(["/"]);
  const stack = [outRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_")) continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.name !== "index.html") continue;
      const relativeDir = path.relative(outRoot, dir);
      if (!relativeDir || relativeDir === "404") continue;
      routes.add(`/${relativeDir.replaceAll(path.sep, "/")}/`);
    }
  }
  return [...routes].sort((a, b) => a.localeCompare(b));
}

function summarizePacket(json) {
  return {
    packet_status: json?.status ?? null,
    state: json?.state ?? null,
    result_qualifier: json?.result_qualifier ?? null,
    source_gap: Boolean(json?.source_gap),
    source_gap_reason: json?.source_gap_reason ?? null,
    schema_version: json?.schema_version ?? null,
    source_of_truth: json?.source_contract?.source_of_truth ?? json?.provenance?.source_of_truth ?? null,
  };
}

async function verifyAbortedApis(apis) {
  await Promise.all(apis.map(async (api) => {
    const abortOnly = api.http_status === "request_failed"
      && api.failures.length
      && api.failures.every((failure) => failure === "net::ERR_ABORTED");
    if (!abortOnly) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(api.url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      api.http_status = response.status;
      const json = await response.json();
      Object.assign(api, summarizePacket(json));
      if (response.ok && (api.packet_status === "ok" || api.packet_status === "source_gap" || api.source_gap)) {
        api.verified_after_abort = true;
        api.failures = [];
      }
    } catch (err) {
      api.failures.push(`direct_verify_failed:${err.name || "error"}`);
    } finally {
      clearTimeout(timeout);
    }
  }));
}

async function crawlPage(page, url, key, graph, queue, seen, base) {
  const result = {
    path: key,
    url,
    http_status: null,
    ok: true,
    failures: [],
    title: "",
    link_count: 0,
    api_count: 0,
  };
  const apiSeenOnPage = new Set();

  const onRequest = (request) => {
    const requestUrl = request.url();
    if (!isBackendUrl(requestUrl)) return;
    if (request.method() !== "GET") return;
    const apiKey = apiKeyFromUrl(requestUrl);
    apiSeenOnPage.add(apiKey);
    const entry = graph.apiMap.get(apiKey) || {
      key: apiKey,
      url: requestUrl,
      http_status: null,
      packet_status: null,
      state: null,
      result_qualifier: null,
      source_gap: null,
      source_gap_reason: null,
      schema_version: null,
      source_of_truth: null,
      pages: [],
      failures: [],
    };
    if (!entry.pages.includes(key)) entry.pages.push(key);
    graph.apiMap.set(apiKey, entry);
    graph.edgeSet.add(JSON.stringify({ from_type: "page", from: key, to_type: "api", to: apiKey }));
  };

  const onResponse = async (response) => {
    const responseUrl = response.url();
    if (!isBackendUrl(responseUrl)) return;
    if (response.request().method() !== "GET") return;
    const apiKey = apiKeyFromUrl(responseUrl);
    apiSeenOnPage.add(apiKey);
    const entry = graph.apiMap.get(apiKey) || {
      key: apiKey,
      url: responseUrl,
      http_status: null,
      packet_status: null,
      state: null,
      result_qualifier: null,
      source_gap: null,
      source_gap_reason: null,
      schema_version: null,
      source_of_truth: null,
      pages: [],
      failures: [],
    };
    entry.http_status = response.status();
    try {
      Object.assign(entry, summarizePacket(await response.json()));
    } catch {
      entry.packet_status = "unreadable_json";
    }
    if (!entry.pages.includes(key)) entry.pages.push(key);
    if (entry.http_status >= 400) entry.failures.push(`http_${entry.http_status}`);
    graph.apiMap.set(apiKey, entry);
    graph.edgeSet.add(JSON.stringify({ from_type: "page", from: key, to_type: "api", to: apiKey }));
  };

  const onRequestFailed = (request) => {
    const requestUrl = request.url();
    if (!isBackendUrl(requestUrl)) return;
    if (request.method() !== "GET") return;
    const apiKey = apiKeyFromUrl(requestUrl);
    const entry = graph.apiMap.get(apiKey) || {
      key: apiKey,
      url: requestUrl,
      http_status: "request_failed",
      packet_status: null,
      state: null,
      result_qualifier: null,
      source_gap: null,
      source_gap_reason: null,
      schema_version: null,
      source_of_truth: null,
      pages: [],
      failures: [],
    };
    entry.http_status = "request_failed";
    entry.failures.push(request.failure()?.errorText || "request_failed");
    if (!entry.pages.includes(key)) entry.pages.push(key);
    graph.apiMap.set(apiKey, entry);
    graph.edgeSet.add(JSON.stringify({ from_type: "page", from: key, to_type: "api", to: apiKey }));
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    result.http_status = response?.status() ?? null;
    if (!response || response.status() >= 400) {
      result.ok = false;
      result.failures.push(`http_${result.http_status}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    result.title = await page.title().catch(() => "");
    const links = await page.$$eval("a[href]", (anchors) => anchors.map((anchor) => anchor.href));
    const normalizedLinks = [];
    for (const href of links) {
      if (!isAppPageUrl(href, base)) continue;
      const target = pageKeyFromUrl(href, base);
      normalizedLinks.push(target);
      graph.edgeSet.add(JSON.stringify({ from_type: "page", from: key, to_type: "page", to: target }));
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
    result.link_count = new Set(normalizedLinks).size;
    result.api_count = apiSeenOnPage.size;
    for (const apiKey of apiSeenOnPage) {
      const api = graph.apiMap.get(apiKey);
      if (api && api.http_status == null) {
        api.failures.push("pending_after_page_wait");
      }
    }
  } catch (err) {
    result.ok = false;
    result.failures.push(`crawl_error:${err.message}`);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);
  }
  graph.pageMap.set(key, result);
}

async function run() {
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const browser = await chromium.launch({     headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  const graph = {
    origin: base,
    generated_at: new Date().toISOString(),
    status: "pass",
    pageMap: new Map(),
    apiMap: new Map(),
    edgeSet: new Set(),
    console_errors: [],
    page_errors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") graph.console_errors.push(message.text());
  });
  page.on("pageerror", (err) => graph.page_errors.push(err.message));

  const queue = discoverExportedRoutes();
  const seen = new Set(queue);
  const maxPages = Number(process.env.SWFIPN_CRAWL_MAX_PAGES || "80");
  while (queue.length && graph.pageMap.size < maxPages) {
    const key = queue.shift();
    await crawlPage(page, urlForPageKey(base, key), key, graph, queue, seen, base);
  }
  await browser.close();

  const pages = [...graph.pageMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const apis = [...graph.apiMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const edges = [...graph.edgeSet].map((edge) => JSON.parse(edge)).sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`));
  await verifyAbortedApis(apis);
  const packetFailures = apis.filter((api) => {
    const observedOk = api.packet_status === "ok" || api.packet_status === "source_gap" || api.source_gap === true;
    if (observedOk && typeof api.http_status === "number" && api.http_status < 400) return false;
    if (observedOk && api.failures.every((failure) => failure === "net::ERR_ABORTED")) return false;
    return (
      (typeof api.http_status === "number" && api.http_status >= 400)
      || api.http_status === "request_failed"
      || api.packet_status === "unreadable_json"
      || api.failures.length > 0
    );
  });
  const sourceGaps = apis.filter((api) => api.source_gap || api.packet_status === "source_gap");
  const routeFailures = pages.filter((route) => !route.ok);
  if (routeFailures.length || packetFailures.length || graph.console_errors.length || graph.page_errors.length) {
    graph.status = "fail";
  }

  const output = {
    origin: graph.origin,
    generated_at: graph.generated_at,
    status: graph.status,
    summary: {
      pages: pages.length,
      apis: apis.length,
      edges: edges.length,
      route_failures: routeFailures.length,
      packet_failures: packetFailures.length,
      source_gaps: sourceGaps.length,
      console_errors: graph.console_errors.length,
      page_errors: graph.page_errors.length,
    },
    pages,
    apis,
    edges,
    route_failures: routeFailures,
    packet_failures: packetFailures,
    source_gaps: sourceGaps,
    console_errors: graph.console_errors,
    page_errors: graph.page_errors,
    artifacts: {
      json: jsonPath,
      mermaid: mermaidPath,
    },
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(mermaidPath, renderMermaid({ pages, apis, edges }));
  console.log(JSON.stringify({
    status: output.status,
    summary: output.summary,
    json: jsonPath,
    mermaid: mermaidPath,
  }, null, 2));
  if (output.status !== "pass") process.exit(1);
}

run().catch((err) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify({ status: "fail", error: err.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(err);
  process.exit(1);
});
