import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-mirrorgraph-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";

const cases = [
  {
    id: "entity_icbc",
    sourceUrl: "https://www.swfi.com/v1/entities/598cdaa50124e9fd2d05b44a",
    detailPath: "/profiles/detail/",
    detailRequired: [
      "ENTITY PROFILE",
      "Industrial & Commercial Bank of China",
      "PROFILE MODULES",
      "Overview",
      "Assets",
      "People",
      "Strategy",
      "Transactions",
      "Compass",
      "Documents",
    ],
  },
  {
    id: "transaction_chatsee",
    sourceUrl: "https://www.swfi.com/v1/transactions/6a2c168b43e7f69d0cd0c923",
    detailPath: "/transactions/detail/",
    detailRequired: [
      "TRANSACTION DETAILS",
      "ChatSee.AI Inc",
      "True Ventures",
      "$6,500,000",
    ],
  },
  {
    id: "compass_calpers",
    sourceUrl: "https://www.swfi.com/v1/compass/69b8dea0dd82ad96bceeb86a",
    detailPath: "/mandates/detail/",
    detailRequired: [
      "COMPASS / RFP DETAIL",
      "CalPERS Issues RFP",
      "California Public Employees Retirement System",
    ],
  },
  {
    id: "people_fatoumata_bouare",
    sourceUrl: "https://www.swfi.com/v1/people/65eadb2f8b8ae6a2bec258f4",
    detailPath: "/people/detail/",
    detailRequired: [
      "PERSON DETAIL",
      "Fatoumata Bouare",
      "Email",
      "SWFI source",
    ],
  },
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

function urlFor(pathname, search = "") {
  const cleanPath = pathname === "/" ? "" : pathname.replace(/^\//, "");
  return new URL(`${cleanPath}${search}`, origin).href;
}

function sourcePageUrl(sourceUrl) {
  const params = new URLSearchParams({ url: sourceUrl, return: "/swficc/" });
  return urlFor("/source/", `?${params.toString()}`);
}

async function login(context) {
  if (!username || !password) throw new Error("missing_auth_test_credentials");
  const page = await context.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await page.goto(urlFor("/login/", `?next=${encodeURIComponent("/swficc/")}`), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/swficc\/(?:$|[?#])/, { timeout: 60_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
  } finally {
    await page.close().catch(() => {});
  }
}

async function waitForBody(page, required, timeout = 45_000) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    if (required.every((text) => lower.includes(text.toLowerCase()))) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const receipt = {
    schema_version: "swfipn.mirrorgraph_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: "pass",
    cases: [],
  };

  try {
    await login(context);
  } catch (error) {
    receipt.status = "fail";
    receipt.cases.push({
      id: "auth_setup",
      ok: false,
      failures: [error.message],
    });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, cases: receipt.cases.length }, null, 2));
    process.exit(1);
  }

  for (const item of cases) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const result = {
      id: item.id,
      source_url: item.sourceUrl,
      source_page_url: sourcePageUrl(item.sourceUrl),
      record_href: "",
      detail_url: "",
      ok: true,
      failures: [],
      errors: [],
    };

    try {
      await page.goto(result.source_page_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const sourceBody = await waitForBody(page, ["SWFIPN Record Page", item.detailPath], 20_000);
      if (!sourceBody.toLowerCase().includes("swfipn record page")) {
        result.failures.push("source_page_missing_record_page");
      }
      const recordHref = await page.locator(`a[href*="${item.detailPath}"]`).first().getAttribute("href", { timeout: 15_000 });
      result.record_href = recordHref || "";
      if (!recordHref) result.failures.push("record_href_missing");
      if (recordHref && !recordHref.includes(item.detailPath)) result.failures.push(`wrong_record_path:${recordHref}`);
      if (recordHref) {
        await page.goto(new URL(recordHref, origin).href, { waitUntil: "domcontentloaded", timeout: 45_000 });
        result.detail_url = page.url();
        const detailBody = await waitForBody(page, item.detailRequired, 60_000);
        for (const required of item.detailRequired) {
          if (!detailBody.toLowerCase().includes(required.toLowerCase())) result.failures.push(`detail_missing:${required}`);
        }
        if (/source gap/i.test(detailBody) && !/Source-backed fact/i.test(detailBody)) {
          result.failures.push("detail_only_source_gap");
        }
      }
    } catch (error) {
      result.failures.push(error.message);
    } finally {
      result.errors = errors;
      if (errors.length) result.failures.push(`console_or_page_errors:${errors.length}`);
      result.ok = result.failures.length === 0;
      if (!result.ok) receipt.status = "fail";
      receipt.cases.push(result);
      await page.close();
    }
  }

  await context.close();
  await browser.close();
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, cases: receipt.cases.length }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
