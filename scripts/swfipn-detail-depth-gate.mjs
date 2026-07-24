import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-detail-depth-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const originUrl = new URL(origin);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || originUrl.origin).replace(/\/$/, "");

const fixtures = [
  {
    id: "profile_related_transactions",
    path: "/profiles/detail/?id=5e5713b876fb1e43b1bb71eb",
    required: [
      "Entity Profile",
      "General Catalyst Partners",
      "Entity Details",
      "Profile Modules",
      "Related Transactions",
      "Buyer Entity",
      "Open all",
    ],
  },
  {
    id: "transaction_buyer_entities",
    path: "/transactions/detail/?id=6a300360f573546e66a087b5",
    backendPath: "/api/transactions/6a300360f573546e66a087b5/v1",
    required: [
      "Transaction Details",
      "Enterprise Therapeutics Limited, Series A",
      "Buyer Entities",
      "Imperial Innovations Group plc",
    ],
    recordRequiredFields: ["amount_display"],
  },
  {
    id: "mandate_summary_attachment",
    path: "/mandates/detail/?id=6a054a79fc240d9d3ab4e22c",
    required: [
      "Compass / RFP Detail",
      "Quincy Contributory Retirement System Issues RFP for Legal Services",
      "RFP / Mandate Details",
      "Summary",
      "Attachment",
    ],
  },
  {
    id: "people_contact_detail",
    path: "/people/detail/?id=65f194e86967a79fee4f5856",
    required: [
      "Person Detail",
      "Tamas Vojnits",
      "Person Details",
      "United Kingdom",
      "SWFI Page",
    ],
  },
  {
    id: "news_article_body",
    path: "/research/detail/?legacy=109243",
    required: [
      "Research / News Detail",
      "HyperLight Announces $80 Million Series C",
      "Article Details",
      "Date not provided in SWFI record",
      "Article / Report Body",
      "HyperLight Corporation announced",
    ],
  },
];

const forbidden = [
  "No internal record mapping",
  "citation-only",
  "No record selected",
  "No Research Record Selected",
  "Source gap",
  "source_gap",
  "Active Mirror",
  "backend_http_",
  "undefined",
  "null",
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

function appUrl(routePath) {
  const clean = String(routePath || "/").replace(/^\//, "");
  return new URL(clean, origin).href;
}

function backendUrl(routePath) {
  return new URL(routePath, `${backendOrigin}/`).href;
}

async function fetchRecordRequiredText(fixture) {
  if (!fixture.backendPath || !Array.isArray(fixture.recordRequiredFields)) return [];
  const response = await fetch(backendUrl(fixture.backendPath), { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  const record = body?.data?.record || {};
  return fixture.recordRequiredFields
    .map((field) => String(record[field] ?? "").trim())
    .filter(Boolean);
}

async function waitForDetailBody(page, expected, timeout = 45_000) {
  const started = Date.now();
  let body = "";
  while (Date.now() - started < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const requiredOk = expected.required.every((item) => lower.includes(item.toLowerCase()));
    const doneLoading = !/\bLoading\b/.test(body);
    if (requiredOk && doneLoading) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const failures = [];
  const pages = [];

  try {
    for (const fixture of fixtures) {
      const page = await context.newPage();
      const url = appUrl(fixture.path);
      const result = {
        id: fixture.id,
        url,
        final_url: "",
        ok: true,
        failures: [],
        required: fixture.required,
        text_excerpt: "",
        raw_swfi_record_links: [],
      };
      try {
        const sourceDerivedRequired = await fetchRecordRequiredText(fixture);
        result.required = [...fixture.required, ...sourceDerivedRequired];
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        const body = await waitForDetailBody(page, { ...fixture, required: result.required });
        result.final_url = page.url();
        result.text_excerpt = body.slice(0, 1200);
        const lower = body.toLowerCase();
        for (const item of result.required) {
          if (!lower.includes(item.toLowerCase())) result.failures.push(`missing_text:${item}`);
        }
        for (const item of forbidden) {
          if (body.includes(item)) result.failures.push(`forbidden_text:${item}`);
        }
        result.raw_swfi_record_links = await page.$$eval(
          'a[href*="www.swfi.com/v1/"],a[href*="cms.swfi.com"]',
          (links) => links.map((link) => link.href).slice(0, 20),
        );
        if (result.raw_swfi_record_links.length) {
          result.failures.push(`raw_swfi_record_links:${result.raw_swfi_record_links.length}`);
        }
      } catch (error) {
        result.failures.push(error.message);
      } finally {
        result.ok = result.failures.length === 0;
        if (!result.ok) failures.push({ id: fixture.id, failures: result.failures, url });
        pages.push(result);
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const receipt = {
    status: failures.length ? "fail" : "pass",
    origin,
    backend_origin: backendOrigin,
    checked_at: new Date().toISOString(),
    pages,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failures, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    status: "fail",
    origin,
    backend_origin: backendOrigin,
    checked_at: new Date().toISOString(),
    fatal: error.message,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(JSON.stringify({ status: "fail", fatal: error.message, receipt: receiptPath }, null, 2));
  process.exit(1);
});
