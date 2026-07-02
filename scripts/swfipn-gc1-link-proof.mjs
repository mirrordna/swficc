#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const expected = new URL("profiles/detail/?id=5e39a581fcbe7e8ca723278c", origin).href;
const url = new URL("profiles/?filter=GC1%20Ventures", origin).href;
const receiptPath = path.join(outputDir, "swfipn-public-gc1-link-proof-latest.json");
const screenshot = path.join(outputDir, "swfipn-public-gc1-link-proof.png");

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadPlaywright() {
  return createRequire(import.meta.url)("playwright");
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let receipt;
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => document.body.innerText.includes("GC1 Ventures") && !/Loading/.test(document.body.innerText), null, { timeout: 90_000 });
    const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]"))
      .filter((a) => (a.textContent || "").includes("GC1 Ventures"))
      .map((a) => ({
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        href: a.href,
        raw: a.getAttribute("href") || "",
      })));
    await page.screenshot({ path: screenshot, fullPage: true });
    const ok = links.some((link) => link.href === expected || link.raw === expected);
    receipt = {
      schema_version: "swfipn.public_gc1_link_proof.v1",
      generated_at: new Date().toISOString(),
      status: ok ? "pass" : "fail",
      url,
      http_status: response?.status() || 0,
      expected,
      links,
      screenshot,
    };
  } catch (error) {
    receipt = {
      schema_version: "swfipn.public_gc1_link_proof.v1",
      generated_at: new Date().toISOString(),
      status: "fail",
      url,
      expected,
      links: [],
      screenshot,
      error: error.message,
    };
  } finally {
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, screenshot }, null, 2));
  return receipt.status === "pass" ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
