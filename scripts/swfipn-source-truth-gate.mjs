import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ORIGIN = (process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/").replace(/\/?$/, "/");
const BACKEND_ORIGIN = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const RESOLVE_IP = process.env.SWFIPN_RESOLVE_IP || "";
const EXPECTED_FACT_SOURCE = process.env.SWFIPN_EXPECTED_FACT_SOURCE || "mongo";
const OUT_DIR = path.resolve("output");
const RECEIPT = path.join(OUT_DIR, "swfipn-source-truth-gate-latest.json");
const SELF = path.resolve(fileURLToPath(import.meta.url));

const forbidden = [
  /Mapped SWFIPN Route/i,
  /Mapped backend value/i,
  /Mapped source/i,
  /internal mirror route/i,
];

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), ORIGIN).toString();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: response.status, body };
}

function scanStaticText() {
  const roots = ["src", "scripts"];
  const hits = [];
  const visit = (filePath) => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(filePath)) visit(path.join(filePath, child));
      return;
    }
    if (!/\.(tsx?|mjs|jsx?)$/.test(filePath)) return;
    if (path.resolve(filePath) === SELF) return;
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) hits.push({ file: filePath, pattern: String(pattern) });
    }
  };
  for (const root of roots) {
    if (fs.existsSync(root)) visit(root);
  }
  return hits;
}

async function inspectSourcePage() {
  const args = RESOLVE_IP ? [`--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} ${RESOLVE_IP}`] : [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const url = appUrl("/source/?url=https%3A%2F%2Fwww.swfi.com%2Fv1%2Ftransactions%2F6a2c168b43e7f69d0cd0c923&return=%2Fswficc%2Ftransactions%2F");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForBody(page, /Open Record|SWFI Source URL/i, 15_000);
  const text = await page.locator("body").innerText();
  const sourceRecordHrefLoop = await hasSourceRecordHrefLoop(page);
  await browser.close();
  return {
    url,
    contains_forbidden: forbidden.some((pattern) => pattern.test(text)),
    contains_record_page: /Open Record/i.test(text),
    source_record_href_loop: sourceRecordHrefLoop,
    first_lines: text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40),
  };
}

async function inspectLegacySourcePage() {
  const args = RESOLVE_IP ? [`--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} ${RESOLVE_IP}`] : [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const url = appUrl("/source/?url=https%3A%2F%2Fwww.swfi.com%2F%3Fp%3D109202&return=%2Fswficc%2Fresearch%2F");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForBody(page, /Open Record|SWFI Source URL/i, 15_000);
  const text = await page.locator("body").innerText();
  const returnHref = await page.getByRole("link", { name: "Return" }).first().getAttribute("href").catch(() => "");
  const sourceRecordHrefLoop = await hasSourceRecordHrefLoop(page);
  const recordHref = await page.locator("section", { hasText: /Open Record/i }).locator("a[href]").first().getAttribute("href").catch(() => "");
  await browser.close();
  return {
    url,
    return_href: returnHref || "",
    record_href: recordHref || "",
    contains_legacy_title: /TPG Pays \$2 Billion|Open Record/i.test(text),
    source_record_href_loop: sourceRecordHrefLoop,
    first_lines: text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40),
  };
}

async function inspectUnmappedSourcePage() {
  const args = RESOLVE_IP ? [`--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} ${RESOLVE_IP}`] : [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const url = appUrl("/source/?url=https%3A%2F%2Fwww.swfi.com%2F%3Fp%3D999999999&return=%2Fswficc%2Fresearch%2F");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await waitForBody(page, /Open Record|SWFI Source URL/i, 15_000);
  const text = await page.locator("body").innerText();
  const recordHref = await page.locator("section", { hasText: /Open Record/i }).locator("a[href]").first().getAttribute("href").catch(() => "");
  await browser.close();
  return {
    url,
    record_href: recordHref || "",
    first_lines: text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40),
  };
}

async function inspectBareSourcePage() {
  const args = RESOLVE_IP ? [`--host-resolver-rules=MAP ${new URL(ORIGIN).hostname} ${RESOLVE_IP}`] : [];
  const browser = await chromium.launch({ channel: "chrome", headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const url = appUrl("/source/");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_000);
  const text = await page.locator("body").innerText();
  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
    text: anchor.textContent?.trim().replace(/\s+/g, " ") || "",
    href: anchor.getAttribute("href") || "",
  }))).catch(() => []);
  await browser.close();
  return {
    url,
    contains_no_source_selected: /No Source Selected/i.test(text),
    contains_fake_no_source_value: /No source URL supplied/i.test(text),
    claims_backend_record_without_url: /citation page for the backend record/i.test(text),
    source_nav_links: links.filter((link) => /^Source$/i.test(link.text) && /\/swficc\/source\/?/.test(link.href)),
    action_links: links.filter((link) => /Search records|Source references/i.test(link.text)),
    first_lines: text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40),
  };
}

async function hasSourceRecordHrefLoop(page) {
  return page.locator("section", { hasText: /Open Record/i }).locator("a[href*='/swficc/source/']").count().then((count) => count > 0).catch(() => false);
}

async function waitForBody(page, pattern, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.locator("body").innerText().catch(() => "");
    if (pattern.test(text)) return text;
    await page.waitForTimeout(500);
  }
  return page.locator("body").innerText().catch(() => "");
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const failures = [];
  const staticHits = scanStaticText();
  if (staticHits.length) failures.push({ id: "forbidden_static_text", hits: staticHits });

  const runtime = await fetchJson(`${BACKEND_ORIGIN}/api/runtime/canonical/v1`);
  const factSource = String(runtime.body.fact_source || "");
  if (factSource !== EXPECTED_FACT_SOURCE) {
    failures.push({
      id: "wrong_backend_fact_source",
      expected: EXPECTED_FACT_SOURCE,
      actual: factSource || "missing",
      runtime_status: runtime.status,
    });
  }

  const sourcePage = await inspectSourcePage();
  if (sourcePage.contains_forbidden) failures.push({ id: "forbidden_public_source_page_text", url: sourcePage.url });
  if (!sourcePage.contains_record_page) failures.push({ id: "missing_swfipn_record_page", url: sourcePage.url });
  if (sourcePage.source_record_href_loop) failures.push({ id: "source_record_page_points_to_source_route", url: sourcePage.url });

  const legacySourcePage = await inspectLegacySourcePage();
  if (legacySourcePage.source_record_href_loop) failures.push({ id: "legacy_source_record_page_points_to_source_route", url: legacySourcePage.url });
  if (!legacySourcePage.record_href.includes("/swficc/research/detail/")) failures.push({ id: "legacy_source_missing_research_detail_record_page", url: legacySourcePage.url, record_href: legacySourcePage.record_href });
  if (!legacySourcePage.record_href.includes("legacy=109202")) failures.push({ id: "legacy_source_missing_legacy_param", url: legacySourcePage.url, record_href: legacySourcePage.record_href });
  if (/\/swficc\/source\//.test(legacySourcePage.return_href)) failures.push({ id: "legacy_source_return_points_to_source_route", url: legacySourcePage.url, return_href: legacySourcePage.return_href });

  const unmappedSourcePage = await inspectUnmappedSourcePage();
  if (!unmappedSourcePage.record_href.includes("/swficc/research/detail/")) failures.push({ id: "unresolved_legacy_source_missing_research_detail_record_page", url: unmappedSourcePage.url, record_href: unmappedSourcePage.record_href });
  if (!unmappedSourcePage.record_href.includes("legacy=999999999")) failures.push({ id: "unresolved_legacy_source_missing_legacy_param", url: unmappedSourcePage.url, record_href: unmappedSourcePage.record_href });

  const bareSourcePage = await inspectBareSourcePage();
  if (!bareSourcePage.contains_no_source_selected) failures.push({ id: "bare_source_missing_no_source_selected", url: bareSourcePage.url });
  if (bareSourcePage.contains_fake_no_source_value) failures.push({ id: "bare_source_renders_fake_no_source_value", url: bareSourcePage.url });
  if (bareSourcePage.claims_backend_record_without_url) failures.push({ id: "bare_source_claims_backend_record_without_url", url: bareSourcePage.url });
  if (bareSourcePage.source_nav_links.length) failures.push({ id: "bare_source_visible_in_workspace_nav", url: bareSourcePage.url, links: bareSourcePage.source_nav_links });
  if (bareSourcePage.action_links.length < 2) failures.push({ id: "bare_source_missing_action_links", url: bareSourcePage.url });

  const receipt = {
    status: failures.length ? "fail" : "pass",
    generated_at: new Date().toISOString(),
    expected_fact_source: EXPECTED_FACT_SOURCE,
    backend_runtime: runtime.body,
    source_page: sourcePage,
    legacy_source_page: legacySourcePage,
    unmapped_source_page: unmappedSourcePage,
    bare_source_page: bareSourcePage,
    static_hits: staticHits,
    failures,
  };
  fs.writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failures, receipt: RECEIPT }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(RECEIPT, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
