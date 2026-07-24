#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-feedback-objective-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:3011/swficc/");
const checkedAt = new Date().toISOString();

const forbiddenDashboardTerms = [
  "BRD V1.3",
  "Glass Box",
  "Command Box",
  "Command Center",
  "Active Mirror",
  "source_gap",
  "source_gap_reason",
  "SWFI-backed rows",
  "SWFIPN record",
  "Open in SWFI",
  "Source on file",
  "Smart Search Bar",
  "No internal record mapping",
  "citation-only",
];

const requiredDashboardTerms = [
  "Total AUM Engaged",
  "Institution Intelligence Overview",
  "Top Active Investors",
  "Recent Activity",
  "Top 10",
  "Showing top 5 dashboard signals",
];

const requiredSearchTerms = [
  "Smart Search",
  "Results are ranked for institutional relevance",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function route(pathname) {
  return new URL(pathname.replace(/^\//, ""), origin).toString();
}

function missingTerms(body, terms) {
  const cleanBody = body.toLowerCase();
  return terms.filter((term) => !cleanBody.includes(term.toLowerCase()));
}

function foundTerms(body, terms) {
  const cleanBody = body.toLowerCase();
  return terms.filter((term) => cleanBody.includes(term.toLowerCase()));
}

function countText(body, pattern) {
  const matches = body.match(pattern);
  return matches ? matches.length : 0;
}

async function pageBody(page, url, required = []) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  if (required.length) {
    await page.waitForFunction((terms) => {
      const body = (document.body?.innerText || "").toLowerCase();
      return terms.every((term) => body.includes(String(term).toLowerCase()));
    }, required, { timeout: 90_000 });
  }
  return page.evaluate(() => ({
    title: document.title,
    url: location.href,
    body: document.body?.innerText || "",
    html: document.documentElement?.outerHTML || "",
    links: Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      text: anchor.textContent?.trim() || "",
      href: anchor.getAttribute("href") || "",
      title: anchor.getAttribute("title") || "",
    })),
  }));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  const screenshots = [];
  let finalStatus = "pass";

  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const dashboardUrl = route("/");
    const dashboard = await pageBody(desktop, dashboardUrl, ["Total AUM Engaged", "Recent Activity"]);
    const dashboardScreenshot = path.join(outputDir, "swfipn-feedback-objective-dashboard.png");
    await desktop.screenshot({ path: dashboardScreenshot, fullPage: false });
    screenshots.push(path.basename(dashboardScreenshot));

    const dashboardMissing = missingTerms(dashboard.body, requiredDashboardTerms);
    const dashboardLeaks = foundTerms(`${dashboard.body}\n${dashboard.html}`, forbiddenDashboardTerms);
    const dashboardRows = {
      recent_activity_mentions: countText(dashboard.body, /Recent Activity/g),
      top_five_mentions: countText(dashboard.body, /Showing top 5 dashboard signals/g),
    };
    results.push({
      id: "dashboard_insight_layer",
      url: dashboard.url,
      expected: "Dashboard presents insight modules, limits dashboard activity cards, and hides internal/project terminology.",
      ok: dashboardMissing.length === 0 && dashboardLeaks.length === 0,
      missing_terms: dashboardMissing,
      forbidden_terms: dashboardLeaks,
      observed: dashboardRows,
    });

    const searchUrl = route("/search/?q=Abu%20Dhabi");
    const search = await pageBody(desktop, searchUrl, ["Smart Search"]);
    const searchMissing = missingTerms(search.body, requiredSearchTerms);
    const searchLeaks = foundTerms(`${search.body}\n${search.html}`, forbiddenDashboardTerms);
    const searchLinks = search.links.filter((link) => link.text && !/^#/.test(link.href));
    const badSearchLabels = searchLinks.filter((link) => /Open in SWFI|Source on file|SWFIPN record|SWFI-backed rows/i.test(`${link.text} ${link.title}`));
    results.push({
      id: "smart_search_relevance_copy",
      url: search.url,
      expected: "Search is positioned as relevance-ranked discovery and does not expose old source/citation copy.",
      ok: searchMissing.length === 0 && searchLeaks.length === 0 && badSearchLabels.length === 0,
      missing_terms: searchMissing,
      forbidden_terms: searchLeaks,
      bad_link_labels: badSearchLabels.slice(0, 10),
    });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobileDashboard = await pageBody(mobile, dashboardUrl, ["Total AUM Engaged", "Recent Activity"]);
    const mobileScreenshot = path.join(outputDir, "swfipn-feedback-objective-mobile.png");
    await mobile.screenshot({ path: mobileScreenshot, fullPage: false });
    screenshots.push(path.basename(mobileScreenshot));
    const mobileLeaks = foundTerms(`${mobileDashboard.body}\n${mobileDashboard.html}`, forbiddenDashboardTerms);
    const mobileBody = mobileDashboard.body.toLowerCase();
    results.push({
      id: "mobile_dashboard_clean_entry",
      url: mobileDashboard.url,
      expected: "Mobile dashboard keeps the same clean entry copy without internal terms.",
      ok: mobileBody.includes("total aum engaged") && mobileBody.includes("recent activity") && mobileLeaks.length === 0,
      forbidden_terms: mobileLeaks,
      body_excerpt: mobileDashboard.body.split("\n").filter(Boolean).slice(0, 30),
    });
  } catch (error) {
    finalStatus = "fail";
    results.push({
      id: "gate_runtime",
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    await browser.close();
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) finalStatus = "fail";

  const receipt = {
    status: finalStatus,
    checked_at: checkedAt,
    origin,
    source_feedback: [
      "/Users/mirror-pro/.codex/attachments/cd55b111-d76c-4f2c-9941-462329606653/pasted-text.txt",
      "/Users/mirror-pro/Downloads/SWFI_Marketing_and_Design_Pack_v0/",
    ],
    summary: {
      checks: results.length,
      failures: failures.length,
      screenshots,
    },
    results,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    receipt: receiptPath,
    failures: failures.map((failure) => failure.id),
    screenshots,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}

await main();
