#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "pdf");
const extractedPath = path.join(outputDir, "key-enhancements-pn-extracted.txt");
const renderedPath = path.join(outputDir, "swfipn-reports-rendered-text.txt");
const receiptPath = path.join(outputDir, "swfipn-pdf-feature-coverage-latest.json");
const pdfPath = process.env.SWFIPN_PDF_PATH || "/Users/mirror-pro/Downloads/Key Enhancements (High Impact) (PN) (2).pdf";

const REQUIRED_FEATURES = [
  "Dashboard",
  "Smart Search",
  "Main Dashboard Area",
  "KPI CARDS",
  "INSIGHTS",
  "QUICK ACTIONS",
  "Historical Performance Dashboard",
  "Competitor Intelligence Module",
  "Investment Trend Analytics",
  "Sector Shift Intelligence",
  "Regional Allocation Trends",
  "Investor Activity Intelligence",
  "Co-Investment Tracking",
  "Deal & Transaction Intelligence",
  "Investor Fit Targeting",
  "Investment Frequency",
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

function includesLoose(haystack, needle) {
  const norm = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(haystack).includes(norm(needle));
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync("pdftotext", ["-layout", pdfPath, extractedPath]);

  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const browser = await chromium.launch({     headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  const route = new URL("reports/", base).href;
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => document.body?.innerText.includes("Key Enhancements") && document.body?.innerText.includes("Investment Frequency"),
    null,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(1000);
  const rendered = await page.evaluate(() => document.body.innerText);
  await browser.close();
  fs.writeFileSync(renderedPath, rendered);

  const pdfText = fs.readFileSync(extractedPath, "utf8");
  const features = REQUIRED_FEATURES.map((feature) => ({
    feature,
    in_pdf: includesLoose(pdfText, feature),
    in_rendered_page: includesLoose(rendered, feature),
    ok: includesLoose(pdfText, feature) && includesLoose(rendered, feature),
  }));
  const receipt = {
    pdf: pdfPath,
    rendered_route: route,
    generated_at: new Date().toISOString(),
    status: features.every((item) => item.ok) ? "pass" : "fail",
    summary: {
      required_features: features.length,
      missing_features: features.filter((item) => !item.ok).length,
    },
    features,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
