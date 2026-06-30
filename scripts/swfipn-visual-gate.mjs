#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-visual-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;

const REQUIRED_TEXT = [
  "TOTAL AUM ENGAGED",
  "ACTIVE RELATIONSHIPS",
  "PIPELINE VALUE",
  "Global Capital Map",
  "Capital Flows",
  "AI Insights",
  "Pipeline Overview",
  "Top Institutional Relationships",
  "Research & Analytics Hub",
  "Market Intelligence",
  "Activity Feed",
  "Deal Intelligence",
  "Data source: SWFI records",
];

const REQUIRED_VISUAL_SECTIONS = [
  "Global Capital Map",
  "Capital Flows & Allocation Trends",
  "AI Insights",
  "Pipeline Overview",
  "Top Institutional Relationships",
  "Research & Analytics Hub",
  "Market Intelligence",
  "Deal Intelligence",
];

const REQUIRED_SVG_LABELS = [
  "Deterministic sector activity and top AUM map",
  "Deterministic stacked capital flow chart",
  "Deterministic pipeline funnel",
  "source-weighted deal momentum",
];

const REQUIRED_ANCHORS = [
  "/swficc/allocators/",
  "/swficc/mandates/",
  "/swficc/transactions/",
  "/swficc/intelligence/",
  "/swficc/profiles/",
  "/swficc/deals/",
  "/swficc/mandates/",
  "/swficc/intelligence/",
];

const FORBIDDEN_VISIBLE_TEXT = [
  "Endpoint:",
  "Source-backed fact",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Mongo Record ID",
  "Runtime Source",
  "SWFIPN source detail",
  "Source packet:",
  "SWFI LOGO",
  "Sidebar",
  "Application error",
  "Unhandled Runtime Error",
  "Not disclosed by SWFI.com",
  "SOURCE_GAP",
];

const VIEWPORTS = [
  { name: "desktop-top", width: 1440, height: 1100, mode: "top" },
  { name: "desktop-visuals", width: 1440, height: 1100, mode: "visuals" },
  { name: "mobile-full", width: 390, height: 900, mode: "full" },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function screenshotPath(name) {
  return path.join(outputDir, `swfipn-visual-${name}.png`);
}

async function fetchHtmlCheck() {
  const entry = {
    id: "raw_html",
    url: origin,
    ok: true,
    status: 0,
    failures: [],
    missing: [],
    asset_refs: [],
  };
  try {
    const response = await fetch(origin);
    entry.status = response.status;
    const html = decodeHtmlEntities(await response.text());
    if (!response.ok) entry.failures.push(`http_${response.status}`);
    entry.missing = REQUIRED_TEXT.filter((text) => !html.includes(text));
    if (entry.missing.length) entry.failures.push(`missing_html_text:${entry.missing.join("|")}`);
    entry.asset_refs = Array.from(html.matchAll(/_next\/static\/[^"']+/g)).map((match) => match[0]).slice(0, 20);
  } catch (error) {
    entry.failures.push(error.message);
  }
  entry.ok = entry.failures.length === 0;
  return entry;
}

async function inspectViewport(browser, spec) {
  const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height } });
  const consoleMessages = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const text = message.text();
      if (/ERR_QUIC_PROTOCOL_ERROR\.QUIC_TOO_MANY_RTOS/i.test(text)) return;
      consoleMessages.push(`${message.type()}: ${text}`);
    }
  });

  const entry = {
    id: `viewport:${spec.name}`,
    url: origin,
    viewport: { width: spec.width, height: spec.height },
    ok: true,
    status: 0,
    failures: [],
    screenshot: screenshotPath(spec.name),
    consoleMessages,
    check: {},
  };

  try {
    const response = await gotoWithRetry(page, origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
    entry.status = response?.status() || 0;
    if (!response || response.status() >= 400) entry.failures.push(`http_${response?.status() || "missing"}`);
    await page.waitForFunction(
      (required) => {
        const body = document.body.innerText;
        const hydratedSourceLinks = document.querySelectorAll('[data-source-state="on-file"], [data-record-link="true"]').length;
        return required.every((text) => body.includes(text))
          && !/\bLoading\b/.test(body)
          && hydratedSourceLinks >= 10;
      },
      REQUIRED_TEXT,
      { timeout: 25_000 },
    );
    await page.waitForTimeout(1_500);

    if (spec.mode === "visuals") {
      await page.evaluate(() => {
        const main = document.querySelector("main");
        const target = Array.from(document.querySelectorAll("section,div"))
          .find((element) => element.textContent?.includes("Capital Flows & Allocation Trends"));
        if (!target) return;
        if (main) {
          const mainRect = main.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          main.scrollTop += targetRect.top - mainRect.top - 90;
        } else {
          target.scrollIntoView({ block: "start" });
        }
      });
      await page.waitForTimeout(500);
    }

    entry.check = await page.evaluate(({ requiredText, requiredAnchors, forbiddenText, requiredVisualSections, requiredSvgLabels, originUrl }) => {
      const body = document.body.innerText;
      const root = new URL(originUrl);
      const appTarget = (route) => {
        const base = root.pathname.replace(/\/$/, "");
        const parsed = route.startsWith(base || "/")
          ? new URL(route, root.origin)
          : new URL(route.replace(/^\//, ""), root.href);
        const path = parsed.pathname === base ? `${parsed.pathname}/` : parsed.pathname.replace(/\/?$/, "/");
        return `${path}${parsed.search}${parsed.hash}`;
      };
      const linkTargetsRoute = (anchor, route) => {
        try {
          const expected = appTarget(route);
          const href = new URL(anchor.href);
          const direct = `${href.pathname.replace(/\/?$/, "/")}${href.search}${href.hash}` === expected;
          const gated = href.pathname.replace(/\/?$/, "/") === appTarget("/login/")
            && href.searchParams.get("next") === expected
            && (anchor.getAttribute("data-dashboard-target") || "") === expected;
          return direct || gated;
        } catch {
          return false;
        }
      };
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const basePath = root.pathname.replace(/\/$/, "");
      const sourceQueryPattern = /(?:[?&]source=|%3Fsource%3D|%26source%3D)/i;
      const objectIdTextPattern = /\b[a-f0-9]{24}\b/i;
      const isLeakedLink = (anchor) => {
        let target;
        try {
          target = new URL(anchor.href);
        } catch {
          return false;
        }
        const joined = [
          anchor.href,
          anchor.getAttribute("href") || "",
          anchor.getAttribute("data-dashboard-target") || "",
          anchor.getAttribute("data-source-href") || "",
        ].join(" ");
        const label = anchor.textContent?.trim().replace(/\s+/g, " ") || "";
        if (sourceQueryPattern.test(joined)) return true;
        if (target.origin === root.origin && target.pathname.startsWith(`${basePath}/v1/`)) return true;
        return objectIdTextPattern.test(label);
      };
      const findSmallestByText = (needle) => Array.from(document.querySelectorAll("section,div"))
        .filter((element) => element.textContent?.includes(needle))
        .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
      const visualSections = requiredVisualSections
        .map((title) => {
          const element = findSmallestByText(title);
          if (!element) return { title, present: false };
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            title,
            present: true,
            top: Math.round(rect.top),
            height: Math.round(rect.height),
            width: Math.round(rect.width),
            opacity: style.opacity,
            display: style.display,
            visibility: style.visibility,
          };
        });
      const svgLabels = Array.from(document.querySelectorAll("svg[aria-label]"))
        .map((element) => element.getAttribute("aria-label") || "");
      const missingSvgLabels = requiredSvgLabels
        .filter((label) => !svgLabels.some((svgLabel) => svgLabel.includes(label)));
      return {
        title: document.title,
        bodyLength: body.length,
        missingText: requiredText.filter((text) => !body.includes(text)),
        forbiddenText: forbiddenText.filter((text) => body.includes(text)),
        missingAnchors: requiredAnchors.filter((href) => !anchors.some((anchor) => linkTargetsRoute(anchor, href))),
        dataSourceLinkCount: document.querySelectorAll('[data-source-state="on-file"], [data-record-link="true"]').length,
        leakedLinks: anchors
          .filter((anchor) => isLeakedLink(anchor))
          .map((anchor) => anchor.textContent?.trim().replace(/\s+/g, " ") || anchor.href)
          .slice(0, 12),
        barCount: Array.from(document.querySelectorAll('div[style*="width"]'))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.height <= 12;
          }).length,
        deterministicSvgCount: svgLabels.length,
        missingSvgLabels,
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollHeight: document.documentElement.scrollHeight,
        },
        visualSections,
      };
    }, {
      requiredText: REQUIRED_TEXT,
      requiredAnchors: REQUIRED_ANCHORS,
      forbiddenText: FORBIDDEN_VISIBLE_TEXT,
      requiredVisualSections: REQUIRED_VISUAL_SECTIONS,
      requiredSvgLabels: REQUIRED_SVG_LABELS,
      originUrl: origin,
    });

    if (entry.check.bodyLength < 1_000) entry.failures.push(`blank_or_thin_body:${entry.check.bodyLength}`);
    if (entry.check.missingText.length) entry.failures.push(`missing_visible_text:${entry.check.missingText.join("|")}`);
    if (entry.check.forbiddenText.length) entry.failures.push(`forbidden_visible_text:${entry.check.forbiddenText.join("|")}`);
    if (entry.check.missingAnchors.length) entry.failures.push(`missing_anchor:${entry.check.missingAnchors.join("|")}`);
    const minimumSourceLinks = spec.mode === "top" ? 10 : 4;
    if (entry.check.dataSourceLinkCount < minimumSourceLinks) entry.failures.push(`too_few_source_links:${entry.check.dataSourceLinkCount}`);
    if (entry.check.leakedLinks?.length) entry.failures.push(`link_id_or_source_leak:${entry.check.leakedLinks.join("|")}`);
    if (entry.check.missingSvgLabels?.length) entry.failures.push(`missing_deterministic_svg:${entry.check.missingSvgLabels.join("|")}`);
    if (entry.check.document.scrollWidth > entry.check.document.clientWidth + 1) {
      entry.failures.push(`horizontal_overflow:${entry.check.document.scrollWidth}>${entry.check.document.clientWidth}`);
    }
    const hiddenVisual = entry.check.visualSections.find((section) => (
      !section.present
      || section.height <= 0
      || section.width <= 0
      || section.opacity === "0"
      || section.display === "none"
      || section.visibility === "hidden"
    ));
    if (hiddenVisual) entry.failures.push(`hidden_visual:${hiddenVisual.title}`);
    if (spec.mode === "top") {
      const expansion = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button"))
          .find((candidate) => candidate.getAttribute("aria-label") === "Expand Global Capital Map");
        const before = button?.getAttribute("aria-expanded") === "false" || false;
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return { before };
      });
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button"))
          .find((candidate) => candidate.getAttribute("aria-label") === "Collapse Global Capital Map");
        const text = button?.textContent || "";
        return { expanded: button?.getAttribute("aria-expanded") === "true", text };
      });
      entry.check.expansion = { ...expansion, ...after };
      if (!entry.check.expansion.before || !entry.check.expansion.expanded) {
        entry.failures.push(`expand_control_failed:${JSON.stringify(entry.check.expansion)}`);
      }
    }
    if (consoleMessages.length) entry.failures.push(`console_messages:${consoleMessages.length}`);

    await page.screenshot({ path: entry.screenshot, fullPage: spec.mode === "full" });
  } catch (error) {
    entry.failures.push(error.message);
    await page.screenshot({ path: entry.screenshot, fullPage: spec.mode === "full" }).catch(() => {});
  } finally {
    await page.close();
  }

  entry.ok = entry.failures.length === 0;
  return entry;
}

async function gotoWithRetry(page, url, options, attempts = 3) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastResponse = await page.goto(url, options);
      const status = lastResponse?.status() || 0;
      if (status && status < 500) return lastResponse;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await page.waitForTimeout(1_500 * (attempt + 1));
  }
  if (lastResponse) return lastResponse;
  if (lastError) throw lastError;
  return null;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const checks = [];
  checks.push(await fetchHtmlCheck());

  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  for (const viewport of VIEWPORTS) {
    checks.push(await inspectViewport(browser, viewport));
  }
  await browser.close();

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    id: check.id,
    url: check.url,
    failures: check.failures,
    screenshot: check.screenshot,
    check: check.check,
  }));
  const receipt = {
    schema_version: "swfipn.visual_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    visual_baseline: true,
    baseline_mode: true,
    baseline_claim: "BRD dashboard visual baseline: required visual sections, deterministic SVGs, expansion control, leakage scan, anchors, desktop screenshots, and mobile screenshot.",
    summary: {
      checks: checks.length,
      viewports: VIEWPORTS.length,
      failures: failures.length,
    },
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.visual_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: "fail",
    visual_baseline: true,
    baseline_mode: true,
    baseline_claim: "BRD dashboard visual baseline attempted but failed before checks completed.",
    summary: { checks: 0, viewports: VIEWPORTS.length, failures: 1 },
    failures: [{ id: "fatal", failures: [error.stack || error.message] }],
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.error(error);
  process.exit(1);
});
