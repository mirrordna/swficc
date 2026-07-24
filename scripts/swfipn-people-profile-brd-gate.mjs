#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(origin).origin).replace(/\/$/, "");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-people-profile-brd-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-people-profile-brd-gate-latest.png");
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  const samplePacket = await fetchJson(`${backendOrigin}/api/source-data/search/v1?collection=people&limit=1&page=1`);
  const sample = samplePacket.body?.data?.rows?.[0] || {};
  const sourceUrl = text(sample.source_url || sample.swfi_url);
  const id = sourceRecordId(sourceUrl);
  const name = text(sample.name || sample.title);
  const target = appUrl(`people/detail/?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&source=${encodeURIComponent(sourceUrl)}`);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const apiResponses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/people/") || response.url().includes("/api/source-data/search/v1?collection=people")) {
      apiResponses.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=Person Details", { timeout: 120_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 120_000 }).catch(() => {});
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const body = await page.locator("body").innerText();
  const lowerBody = body.toLowerCase();
  const requiredText = [
    "Person Detail",
    "Verified in SWFI records",
    "Profile Actions",
    "Overview",
    "Contact",
    "SWFI Page",
    "Person Details",
    "SWFI Page",
    "Export Contact",
    "Profile Link",
    "Follow requires SWFI account access",
  ];
  const missing = requiredText.filter((item) => !lowerBody.includes(item.toLowerCase()));
  const hasEmailAction = body.includes("Copy Email") || body.includes("Email not disclosed");
  const hasLinkedInAction = body.includes("LinkedIn");
  const vcardLinks = await page.locator("a[download$='.vcf']").count();
  const sectionLinks = await page.locator("nav[aria-label='Person profile sections'] a[href^='#']").count();
  const sourceOnFileLinks = await page.locator("[data-source-state='on-file']").count();
  const internalLeaks = ["Active Mirror", "source_gap", "backend_http", "undefined", "null"].filter((needle) => body.includes(needle));
  const failures = [];
  if ((response?.status() || 0) >= 400) failures.push(`http_${response?.status() || 0}`);
  if (samplePacket.status >= 400 || samplePacket.body?.status !== "ok") failures.push(`sample_api_${samplePacket.status}`);
  if (!id) failures.push("sample_missing_people_id");
  if (missing.length) failures.push(`missing_text:${missing.join("|")}`);
  if (!hasEmailAction) failures.push("missing_copy_email_or_unavailable_state");
  if (!hasLinkedInAction) failures.push("missing_linkedin_action_or_unavailable_state");
  if (vcardLinks < 1) failures.push("missing_vcard_export");
  if (sectionLinks < 3) failures.push(`section_nav_links_${sectionLinks}_lt_3`);
  if (sourceOnFileLinks < 1) failures.push("missing_source_on_file_link");
  if (!apiResponses.some((item) => item.status === 200)) failures.push("missing_people_detail_api_200");
  if (internalLeaks.length) failures.push(`internal_leaks:${internalLeaks.join("|")}`);
  if (consoleErrors.length) failures.push("console_errors_present");

  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.people_profile_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    status,
    sample: { name, id, source_url: sourceUrl, url: target },
    summary: {
      api_200: apiResponses.some((item) => item.status === 200),
      missing,
      has_email_action_or_unavailable_state: hasEmailAction,
      has_linkedin_action_or_unavailable_state: hasLinkedInAction,
      vcard_links: vcardLinks,
      section_nav_links: sectionLinks,
      source_on_file_links: sourceOnFileLinks,
      internal_leaks: internalLeaks,
      console_errors: consoleErrors.slice(0, 10),
      failures,
    },
    api_responses: apiResponses,
    screenshot: screenshotPath,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SWFIPN-PeopleProfileBRDGate/1.0" } });
  const textBody = await response.text();
  let body;
  try {
    body = JSON.parse(textBody);
  } catch {
    body = { raw: textBody.slice(0, 500) };
  }
  return { status: response.status, body };
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function text(value) {
  return String(value ?? "").trim();
}

function sourceRecordId(value) {
  const match = text(value).match(/\/people\/([a-f0-9]{24})\/?$/i);
  return match ? match[1].toLowerCase() : "";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
