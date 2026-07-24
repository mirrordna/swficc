#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-accessibility-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const routes = (process.env.SWFIPN_ACCESSIBILITY_ROUTES || "/,/search/?q=PIF,/profiles/,/transactions/,/mandates/")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const checks = [];

  try {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const url = appUrl(route);
      const check = { route, url, status: 0, violations: [], failures: [] };
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        check.status = response?.status() || 0;
        if (!response || response.status() >= 400) check.failures.push(`http_${response?.status() || "missing"}`);
        await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => null);
        await page.waitForTimeout(750);

        const results = await new AxeBuilder({ page })
          .disableRules([
            // The dashboard uses dense data visualization; color contrast is tracked by visual QA
            // until the SWFI brand palette is frozen.
            "color-contrast",
          ])
          .analyze();
        check.violations = results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
          nodes: violation.nodes.length,
          sample_targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
        }));
        const blockingViolations = check.violations.filter((violation) => ["critical", "serious"].includes(violation.impact || ""));
        for (const violation of blockingViolations) {
          check.failures.push(`axe_${violation.impact}:${violation.id}:${violation.nodes}`);
        }
      } catch (error) {
        check.failures.push(error.message);
      } finally {
        await context.close().catch(() => null);
      }
      if (check.failures.length) failures.push(...check.failures.map((failure) => `${route}:${failure}`));
      checks.push(check);
    }
  } finally {
    await browser.close().catch(() => null);
  }

  const receipt = {
    schema_version: "swfipn.accessibility_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: {
      routes: routes.length,
      failures: failures.length,
      violations: checks.reduce((sum, check) => sum + check.violations.length, 0),
    },
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
