#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire("/Users/mirror-pro/repos/swfireskin/package.json");
const { chromium } = require("playwright");

const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:4317").replace(/\/$/, "");
const checks = [];

function check(id, pass, evidence) {
  checks.push({ id, status: pass ? "PASS" : "FAIL", evidence: String(evidence || "").slice(0, 1000) });
}

function packet(rows, extra = {}) {
  return {
    status: "ok",
    fact: true,
    generated_at: "2026-07-16T12:00:00Z",
    data: { rows, count: rows.length, source_total: rows.length, ...extra },
  };
}

const newsRows = [
  {
    id: "news-new",
    legacy_post: "109307",
    title: "Newest source-backed story",
    published_at: "2026-07-16",
    updated_at: "2026-07-16",
    excerpt: "Newest story excerpt.",
    source_url: "https://www.swfi.com/v1/news/109307",
  },
  {
    id: "news-old",
    legacy_post: "109000",
    title: "Older source-backed story",
    published_at: "2026-06-01",
    updated_at: "2026-06-02",
    excerpt: "Older story excerpt.",
    source_url: "https://www.swfi.com/v1/news/109000",
  },
];

const reportPage1 = [
  {
    id: "report-new",
    report_key: "q1-2024",
    title: "SWFI Quarterly 2024 Q1",
    type: "quarterly",
    published_at: "2024-05-02",
    report_url: "https://www.swfi.com/reports/q1-2024.pdf",
    source_url: "https://www.swfi.com/reports/q1-2024.pdf",
  },
  {
    id: "report-mid",
    report_key: "q4-2023",
    title: "SWFI Quarterly 2023 Q4",
    type: "quarterly",
    published_at: "2024-02-01",
    report_url: "https://www.swfi.com/reports/q4-2023.pdf",
    source_url: "https://www.swfi.com/reports/q4-2023.pdf",
  },
];

const reportPage2 = [
  {
    id: "report-old",
    report_key: "q3-2023",
    title: "SWFI Quarterly 2023 Q3",
    type: "quarterly",
    published_at: "2023-11-01",
    report_url: "https://www.swfi.com/reports/q3-2023.pdf",
    source_url: "https://www.swfi.com/reports/q3-2023.pdf",
  },
];

const browser = await chromium.launch({ channel: "chrome" });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/api/source-intelligence/news/v1**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet(newsRows)) });
  });
  await context.route("**/api/reports/v1**", async (route) => {
    const page = new URL(route.request().url()).searchParams.get("page") || "1";
    const rows = page === "2" ? reportPage2 : reportPage1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(packet(rows, { count: 3, source_total: 3, page: Number(page), requested_limit: 50 })),
    });
  });

  const intelligence = await context.newPage();
  intelligence.setDefaultTimeout(60_000);
  await intelligence.goto(`${ORIGIN}/swficc/intelligence/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const recordsButton = intelligence.getByRole("button", { name: "Records" });
  const visibleRecords = intelligence.locator("main tbody:visible");
  for (let attempt = 0; attempt < 6 && await visibleRecords.count() === 0; attempt += 1) {
    await recordsButton.click();
    await visibleRecords.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
  }
  await visibleRecords.first().waitFor({ state: "visible" });
  await intelligence.locator('main tbody:visible a', { hasText: "Newest source-backed story" }).first().waitFor({ state: "visible" });
  const intelligenceRows = intelligence.locator("main tbody:visible tr");
  const firstNewsRow = (await intelligenceRows.first().innerText()).replace(/\s+/g, " ").trim();
  const newsHeaders = await intelligence.locator("main thead th").allTextContents();
  const newsHandoff = await intelligenceRows.first().locator("a", { hasText: "Newest source-backed story" }).first().getAttribute("href");
  check("news_published_column", newsHeaders.some((value) => /Published/i.test(value)), JSON.stringify(newsHeaders));
  check("news_default_newest_first", /Newest source-backed story/.test(firstNewsRow) && /2026-07-16/.test(firstNewsRow), firstNewsRow);
  check(
    "news_authenticated_record_handoff",
    Boolean(newsHandoff?.includes("www.swfi.com/v1/signin/") && decodeURIComponent(newsHandoff).includes("/v1/news/109307")),
    newsHandoff || "missing",
  );
  await intelligence.screenshot({ path: "output/swfipn-news-freshness-latest.png", fullPage: true });
  await intelligence.close();

  const reports = await context.newPage();
  reports.setDefaultTimeout(60_000);
  await reports.goto(`${ORIGIN}/swficc/reports/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const expectedSummary = "Latest report on file: May 2, 2024 · Historical catalog · 3 records";
  await reports.getByText(new RegExp(expectedSummary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first().waitFor({ state: "visible" });
  const reportsSection = reports.locator("section", { has: reports.getByRole("heading", { name: "Quarterly Reports", exact: true }) });
  const reportRows = reportsSection.locator("tbody tr");
  const firstReportRow = (await reportRows.first().innerText()).replace(/\s+/g, " ").trim();
  const reportSectionText = (await reportsSection.innerText()).replace(/\s+/g, " ").trim();
  check("reports_catalog_honest_as_of", (await reports.locator("body").innerText()).includes(expectedSummary), expectedSummary);
  check("reports_full_catalog_pages", /Showing 3 of 3/.test(reportSectionText), reportSectionText);
  check("reports_default_newest_first", /SWFI Quarterly 2024 Q1/.test(firstReportRow) && /2024-05-02/.test(firstReportRow), firstReportRow);
  await reports.screenshot({ path: "output/swfipn-reports-freshness-latest.png", fullPage: true });
  await reports.close();

  const homeContext = await browser.newContext({ serviceWorkers: "block" });
  let homepageNewsRequests = 0;
  const leadStories = [
    {
      id: "news-lead-a",
      legacy_post: "900001",
      title: "Top story before refresh",
      published_at: "2026-07-16T10:00:00Z",
      excerpt: "First lead story.",
      source_url: "https://www.swfi.com/v1/news/900001",
      preview_image_url: "/api/source-intelligence/news/preview-image/v1?legacy_id=900001",
    },
    {
      id: "news-lead-b",
      legacy_post: "900002",
      title: "Top story after refresh",
      published_at: "2026-07-16T12:00:00Z",
      excerpt: "Second lead story.",
      source_url: "https://www.swfi.com/v1/news/900002",
      preview_image_url: "/api/source-intelligence/news/preview-image/v1?legacy_id=900002",
    },
    {
      id: "news-lead-c",
      legacy_post: "900003",
      title: "Top story with safe fallback",
      published_at: "2026-07-16T13:00:00Z",
      excerpt: "Lead story whose editorial image is unavailable.",
      source_url: "https://www.swfi.com/v1/news/900003",
      preview_image_url: "/api/source-intelligence/news/preview-image/v1?legacy_id=900003",
    },
  ];
  const previewPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await homeContext.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/source-intelligence/news/v1") {
      const lead = leadStories[Math.min(homepageNewsRequests, leadStories.length - 1)];
      homepageNewsRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet([lead])) });
      return;
    }
    if (url.pathname === "/api/source-intelligence/news/preview-image/v1") {
      if (url.searchParams.get("legacy_id") === "900003") {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "image/png", body: previewPng });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet([])) });
  });
  await homeContext.route("**/v1/swfi/top20**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet([])) });
  });
  const homepage = await homeContext.newPage();
  homepage.setDefaultTimeout(60_000);
  await homepage.goto(`${ORIGIN}/swficc/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const featuredStory = homepage.getByTestId("featured-news-story");
  const featuredImage = homepage.getByTestId("featured-news-image");
  await featuredStory.getByRole("heading", { name: "Top story before refresh", exact: true }).waitFor({ state: "visible" });
  const firstStoryId = await featuredStory.getAttribute("data-news-story-id");
  const firstImageSource = await featuredImage.getAttribute("src");
  await homepage.evaluate(() => window.dispatchEvent(new Event("swfi:refresh-news")));
  await featuredStory.getByRole("heading", { name: "Top story after refresh", exact: true }).waitFor({ state: "visible" });
  await homepage.waitForFunction(() => document.querySelector('[data-testid="featured-news-image"]')?.getAttribute("src")?.includes("legacy_id=900002"));
  const secondStoryId = await featuredStory.getAttribute("data-news-story-id");
  const secondImageSource = await featuredImage.getAttribute("src");
  const secondImageMode = await featuredImage.getAttribute("data-news-image-source");
  check("homepage_lead_story_auto_refresh", homepageNewsRequests >= 2 && firstStoryId === "900001" && secondStoryId === "900002", `requests=${homepageNewsRequests} ${firstStoryId}->${secondStoryId}`);
  check("homepage_lead_image_follows_story", firstImageSource !== secondImageSource && secondImageSource?.includes("legacy_id=900002") && secondImageMode === "editorial", `${firstImageSource} -> ${secondImageSource} (${secondImageMode})`);
  await homepage.evaluate(() => window.dispatchEvent(new Event("swfi:refresh-news")));
  await featuredStory.getByRole("heading", { name: "Top story with safe fallback", exact: true }).waitFor({ state: "visible" });
  await homepage.waitForFunction(() => document.querySelector('[data-testid="featured-news-image"]')?.getAttribute("data-news-image-source") === "story-fallback");
  const fallbackImageSource = await featuredImage.getAttribute("src");
  check("homepage_lead_image_safe_fallback", fallbackImageSource?.startsWith("data:image/svg+xml,") && await featuredImage.getAttribute("data-news-story-id") === "900003", `${await featuredImage.getAttribute("data-news-image-source")} ${String(fallbackImageSource).slice(0, 80)}`);
  await homepage.screenshot({ path: "output/swfipn-homepage-live-lead-story-latest.png", fullPage: true });
  await homeContext.close();
} finally {
  await browser.close();
}

mkdirSync("output", { recursive: true });
const receipt = {
  schema_version: "swfipn.freshness_browser_gate.v1",
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  pass: checks.every((item) => item.status === "PASS"),
  checks,
};
writeFileSync("output/swfipn-freshness-browser-latest.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ pass: receipt.pass, checks: checks.length, failing: checks.filter((item) => item.status === "FAIL").map((item) => item.id) }, null, 2));
if (!receipt.pass) process.exitCode = 1;
