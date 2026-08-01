#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-doctrine-gate-latest.json");
const pdfPath = process.env.SWFIPN_PDF || "/Users/mirror-pro/Downloads/Key Enhancements (High Impact) (PN) (2).pdf";

const forbiddenText = [
  "38,412",
  "1,284",
  "$120B",
  "+12%       60 Investors",
  "60 Investors",
  "ADIA invests in AI fund",
  "GIC opens $500M infrastructure mandate",
  "CPP increases energy exposure",
];

const pdfRequired = [
  "Key Enhancements (High Impact)",
  "1 Dashboard",
  "Smart Search",
  "Main Dashboard Area",
  "KPI CARDS",
  "INSIGHTS",
  "QUICK ACTIONS",
  "Co-Investment Tracking",
  "Investor Fit Targeting",
  "Investment Frequency",
];

const routes = [
  {
    path: "/",
    mode: "public",
    required: [
      "SWFI",
      "Here's your intelligence and pipeline overview.",
      "Global Capital Map",
      "AI Insights",
      "Recent Activity",
      "Transactions",
      "MARKET FOCUS",
      "Compass Investment Types",
      "SWF Buys by Sector",
    ],
  },
  { path: "/profiles/", mode: "public", required: ["Institutions", "Institution Data Visualization", "Highlighted SWFI Pages"] },
  { path: "/people/", mode: "public", required: ["People", "People Data Visualization", "Highlighted SWFI Pages"] },
  { path: "/transactions/", mode: "public", required: ["Transactions", "Transaction Data Visualization", "Highlighted SWFI Pages"] },
  { path: "/mandates/", mode: "public", required: ["RFPs / Mandates", "Compass RFP Analytics", "RFPs by Investment Type"] },
  { path: "/reports/", mode: "public", required: ["Reports Intelligence", "AUM Rankings"] },
  { path: "/search/", mode: "public", required: ["Smart Search", "Results are ranked for institutional relevance", "TYPE"] },
  { path: "/research/", mode: "public", required: ["Research / News", "Data view", "this table shows the matching records"] },
];

const viewportChecks = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "iab-narrow", width: 582, height: 643 },
  { name: "mobile", width: 390, height: 844 },
];

function loadPlaywright() {
  const roots = [
    repoRoot,
    "/Users/mirror-pro/repos/SWFI2.0-final-frontend",
    "/Users/mirror-pro/repos/SWFI2.0-final",
  ];
  for (const root of roots) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeBase(input) {
  const value = input || "http://127.0.0.1:8353/swficc/";
  return value.endsWith("/") ? value : `${value}/`;
}

function routeUrl(base, routePath) {
  if (routePath === "/") return base;
  return new URL(routePath.replace(/^\//, ""), base).href;
}

function isBackendPacketUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/session/status/v1" || parsed.pathname === "/swficc/api/session/status/v1") {
      return false;
    }
    return parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

function publicPacketShape(json) {
  const data = json && typeof json.data === "object" && json.data !== null ? json.data : null;
  const rows = Array.isArray(data?.rows) ? data.rows.length : null;
  const count = Number(data?.count ?? data?.total ?? data?.source_total ?? Number.NaN);
  const forbiddenInternalFields = [
    "schema_version",
    "doctrine_id",
    "state",
    "result_qualifier",
    "source_gap_reason",
    "source_collection",
    "source_collections",
    "source_contract",
    "backend_identifier",
    "backend_id",
    "environment",
    "stack",
    "trace",
  ].filter((field) => Object.prototype.hasOwnProperty.call(json || {}, field));
  return {
    has_data: Boolean(data),
    rows,
    count: Number.isFinite(count) ? count : null,
    forbidden_internal_fields: forbiddenInternalFields,
  };
}

function normalizePathname(pathname) {
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function appPath(base, pathPart) {
  return normalizePathname(new URL(pathPart.replace(/^\//, ""), base).pathname);
}

function pathSearchHash(url) {
  const parsed = new URL(url);
  return `${normalizePathname(parsed.pathname)}${parsed.search}${parsed.hash}`;
}

function readPdfDoctrine() {
  const result = spawnSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  const entry = {
    path: pdfPath,
    status: result.status,
    ok: result.status === 0,
    failures: [],
  };
  if (result.status !== 0) {
    entry.failures.push(`pdftotext_failed:${result.stderr || "unknown"}`);
    return entry;
  }
  for (const expected of pdfRequired) {
    if (!result.stdout.includes(expected)) {
      entry.ok = false;
      entry.failures.push(`missing_pdf_text:${expected}`);
    }
  }
  return entry;
}

async function collectRoute(page, base, route, receipt) {
  const url = routeUrl(base, route.path);
  const routeResult = { path: route.path, url, mode: route.mode || "public", status: null, final_url: "", ok: true, failures: [] };
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  routeResult.status = response?.status() ?? null;
  if (!response || response.status() >= 400) {
    routeResult.ok = false;
    routeResult.failures.push(`http_status_${routeResult.status}`);
  }
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  routeResult.final_url = page.url();
  const bodyText = await page.locator("body").innerText({ timeout: 15_000 });

  if (route.mode === "protected") {
    const final = new URL(routeResult.final_url);
    const loginPath = appPath(base, "/login/");
    const expectedNext = pathSearchHash(url);
    if (normalizePathname(final.pathname) !== loginPath) {
      routeResult.ok = false;
      routeResult.failures.push(`not_login_gated:${routeResult.final_url}`);
    }
    if (final.searchParams.get("next") !== expectedNext) {
      routeResult.ok = false;
      routeResult.failures.push(`next_mismatch:${final.searchParams.get("next") || ""}`);
    }
    if (!bodyText.includes("Subscriber Sign In")) {
      routeResult.ok = false;
      routeResult.failures.push("missing_text:Subscriber Sign In");
    }
    if (bodyText.includes("Showing ")) {
      routeResult.ok = false;
      routeResult.failures.push("protected_table_visible_unauthenticated");
    }
  } else {
    for (const expected of route.required || []) {
      if (!bodyText.includes(expected)) {
        routeResult.ok = false;
        routeResult.failures.push(`missing_text:${expected}`);
      }
    }
  }
  for (const forbidden of forbiddenText) {
    if (bodyText.includes(forbidden)) {
      routeResult.ok = false;
      routeResult.failures.push(`forbidden_seed_text:${forbidden}`);
    }
  }
  const badLinks = await page.$$eval("a[href]", (links) => links
    .map((link) => link.getAttribute("href") || "")
    .filter((href) => href === "#" || href.startsWith("javascript:") || href.includes("/admin") || href.includes("/api-docs")));
  if (badLinks.length) {
    routeResult.ok = false;
    routeResult.failures.push(`bad_links:${badLinks.join(",")}`);
  }
  receipt.routes.push(routeResult);
}

async function collectViewport(page, base, viewport, receipt) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(routeUrl(base, "/"), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  const screenshot = path.join(outputDir, `swfipn-doctrine-${viewport.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const check = await page.evaluate(() => {
    const root = document.documentElement;
    const bodyText = document.body.innerText;
    const primaryText = [
      "Here's your intelligence and pipeline overview.",
      "Global Capital Map",
      "AI Insights",
      "Recent Activity",
      "Transactions",
      "MARKET FOCUS",
      "Compass Investment Types",
      "SWF Buys by Sector",
    ];
    const narrowCards = Array.from(document.querySelectorAll("[data-qa-min]"))
      .map((node) => {
        const el = node;
        const min = Number(el.getAttribute("data-qa-min") || 0);
        const rect = el.getBoundingClientRect();
        return { text: el.textContent?.trim().slice(0, 80) || "", width: rect.width, min };
      })
      .filter((item) => item.width + 0.5 < item.min);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
      },
      hasBodyOverflowX: root.scrollWidth > root.clientWidth + 2,
      missingPrimaryText: primaryText.filter((text) => !bodyText.includes(text)),
      narrowCards,
    };
  });
  const result = {
    ...viewport,
    screenshot,
    ok: true,
    failures: [],
    check,
  };
  if (check.hasBodyOverflowX) {
    result.ok = false;
    result.failures.push(`body_horizontal_overflow:${check.document.scrollWidth}>${check.document.clientWidth}`);
  }
  if (check.missingPrimaryText.length) {
    result.ok = false;
    result.failures.push(`missing_primary_text:${check.missingPrimaryText.join(",")}`);
  }
  if (check.narrowCards.length) {
    result.ok = false;
    result.failures.push(`narrow_fact_cards:${check.narrowCards.map((card) => `${Math.round(card.width)}<${card.min}`).join(",")}`);
  }
  receipt.viewports.push(result);
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const browser = await chromium.launch({     headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const receipt = {
    origin: base,
    generated_at: new Date().toISOString(),
    status: "pass",
    pdf: readPdfDoctrine(),
    forbidden_text: forbiddenText,
    routes: [],
    viewports: [],
    packets: [],
    console: [],
    page_errors: [],
  };
  const responseTasks = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") receipt.console.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => receipt.page_errors.push(err.message));
  page.on("response", (response) => {
    const task = (async () => {
    const url = response.url();
    if (!isBackendPacketUrl(url)) return;
    if (response.request().method() !== "GET") return;
    const entry = { url, status: response.status(), packet_status: null, source_gap: null, has_data: false, rows: null, count: null, forbidden_internal_fields: [] };
    try {
      const json = await response.json();
      entry.packet_status = json?.status ?? null;
      entry.source_gap = Boolean(json?.source_gap);
      Object.assign(entry, publicPacketShape(json));
    } catch {
      entry.packet_status = "unreadable_json";
    }
    receipt.packets.push(entry);
    })();
    responseTasks.push(task);
  });

  for (const route of routes) {
    await collectRoute(page, base, route, receipt);
  }
  for (const viewport of viewportChecks) {
    await collectViewport(page, base, viewport, receipt);
  }
  await Promise.allSettled(responseTasks);

  for (const packet of receipt.packets) {
    const okPublicFact = packet.packet_status === "ok" && packet.has_data && !packet.source_gap;
    const okCleanGap = packet.packet_status === "source_gap" || packet.source_gap === true;
    if (packet.forbidden_internal_fields?.length) {
      packet.failure = `public_packet_internal_fields:${packet.forbidden_internal_fields.join(",")}`;
    } else if (packet.status >= 400 || (!okPublicFact && !okCleanGap)) {
      packet.failure = "packet_not_public_fact_or_clean_gap";
    }
  }

  const expectedConsole = [];
  const actionableConsole = [];
  for (const entry of receipt.console) {
    if (entry.text.includes("the server responded with a status of 401")) expectedConsole.push(entry);
    else actionableConsole.push(entry);
  }
  receipt.console = actionableConsole;
  receipt.ignored_console = expectedConsole;

  const failures = [];
  if (!receipt.pdf.ok) failures.push("pdf_doctrine_failed");
  if (receipt.routes.some((route) => !route.ok)) failures.push("route_failed");
  if (receipt.viewports.some((viewport) => !viewport.ok)) failures.push("viewport_failed");
  if (receipt.packets.some((packet) => packet.failure)) failures.push("packet_failed");
  if (receipt.console.length) failures.push("console_error");
  if (receipt.page_errors.length) failures.push("page_error");
  if (failures.length) {
    receipt.status = "fail";
    receipt.failures = failures;
  }

  await browser.close();
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, screenshots: receipt.viewports.map((viewport) => viewport.screenshot) }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((err) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: err.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(err);
  process.exit(1);
});
