#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-sitemap-click-crawl-latest.json");

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final-frontend", "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeBase(input) {
  const value = input || "http://127.0.0.1:8353/swficc/";
  return value.endsWith("/") ? value : `${value}/`;
}

function discoverRoutes() {
  const outRoot = path.join(repoRoot, "out");
  const routes = new Set(["/"]);
  const stack = [outRoot];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) stack.push(full);
        continue;
      }
      if (entry.name !== "index.html") continue;
      const rel = path.relative(outRoot, dir).replaceAll(path.sep, "/");
      if (rel && rel !== "404" && rel !== "_not-found") routes.add(`/${rel}/`);
    }
  }
  return [...routes].sort((a, b) => a.localeCompare(b));
}

function routeUrl(base, route) {
  return route === "/" ? base : new URL(route.replace(/^\//, ""), base).href;
}

function sameAppUrl(url, base) {
  const parsed = new URL(url);
  const root = new URL(base);
  const basePath = root.pathname.replace(/\/$/, "");
  return parsed.origin === root.origin
    && (parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`))
    && !parsed.pathname.includes("/_next/")
    && !parsed.pathname.includes("favicon");
}

function canonicalUrl(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/?$/, "/")}`;
}

async function pageInventory(page, route, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(750);
  return page.evaluate(({ route, status }) => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return {
      route,
      status,
      url: location.href,
      title: document.title,
      body_first: document.body.innerText.split("\n").slice(0, 30),
      source_gap_count: (document.body.innerText.match(/Source gap/g) || []).length,
      loading_count: (document.body.innerText.match(/Loading/g) || []).length,
      links: Array.from(document.querySelectorAll("a[href]"))
        .map((a, index) => ({
          index,
          text: a.innerText.trim().replace(/\s+/g, " "),
          href: a.href,
          raw: a.getAttribute("href"),
          visible: visible(a),
        }))
        .filter((link) => link.visible),
      forms: Array.from(document.querySelectorAll("form")).map((form, index) => ({
        index,
        action: form.action,
        method: form.method,
        text: form.innerText.trim().replace(/\s+/g, " "),
        inputs: Array.from(form.querySelectorAll("input,select,textarea")).map((input) => ({
          tag: input.tagName.toLowerCase(),
          id: input.id,
          name: input.getAttribute("name") || "",
          type: input.getAttribute("type") || "",
          value: input.value || "",
          placeholder: input.getAttribute("placeholder") || "",
        })),
      })),
    };
  }, { route, status: response?.status() || null });
}

async function clickVisibleLink(browser, base, fromRoute, link) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const result = {
    from: fromRoute,
    text: link.text,
    href: link.href,
    ok: true,
    failures: [],
    final_url: null,
    body_first: [],
  };
  try {
    await page.goto(routeUrl(base, fromRoute), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(250);
    const beforeClick = canonicalUrl(page.url());
    const expected = canonicalUrl(link.href);
    const clicked = await page.evaluate((target) => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const links = Array.from(document.querySelectorAll("a[href]")).filter(visible);
      const link = links.find((a) => a.href === target.href && a.innerText.trim().replace(/\s+/g, " ") === target.text)
        || links.find((a) => a.href === target.href);
      if (!link) return false;
      link.click();
      return true;
    }, { href: link.href, text: link.text });
    if (!clicked) {
      result.ok = false;
      result.failures.push("link_not_found_for_click");
      return result;
    }
    if (beforeClick !== expected) {
      await page.waitForFunction((target) => {
        const parsed = new URL(location.href);
        const current = `${parsed.origin}${parsed.pathname.replace(/\/?$/, "/")}`;
        return current === target;
      }, expected, { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(250);
    } else {
      await page.waitForTimeout(250);
    }
    result.final_url = page.url();
    result.body_first = await page.evaluate(() => document.body.innerText.split("\n").slice(0, 12)).catch(() => []);
    if (canonicalUrl(result.final_url) !== expected) {
      result.ok = false;
      result.failures.push(`wrong_destination:${canonicalUrl(result.final_url)}!=${expected}`);
    }
    if (!result.body_first.length || result.body_first.join(" ").includes("404:")) {
      result.ok = false;
      result.failures.push("blank_or_404_destination");
    }
  } catch (error) {
    result.ok = false;
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function submitSearch(browser, base, route, inputSelector, query, expectedText) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const result = { route, query, expectedText, ok: true, failures: [], final_url: null, body_first: [] };
  try {
    await page.goto(routeUrl(base, route), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator(inputSelector).fill(query, { timeout: 15_000 });
    await page.locator(inputSelector).press("Enter", { timeout: 15_000 });
    await page.waitForURL("**/swficc/search/**", { timeout: 45_000 }).catch(() => {});
    await page.waitForFunction((text) => document.body.innerText.includes(text), expectedText, { timeout: 90_000 });
    result.final_url = page.url();
    result.body_first = await page.evaluate(() => document.body.innerText.split("\n").slice(0, 30));
  } catch (error) {
    result.ok = false;
    result.failures.push(error.message);
    result.final_url = page.url();
    result.body_first = await page.evaluate(() => document.body.innerText.split("\n").slice(0, 30)).catch(() => []);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });

  const pages = [];
  const click_results = [];
  const form_results = [];
  const console_errors = [];
  const page_errors = [];

  const inventoryPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  inventoryPage.on("console", (msg) => {
    if (["error", "warning", "warn"].includes(msg.type())) console_errors.push({ type: msg.type(), text: msg.text() });
  });
  inventoryPage.on("pageerror", (err) => page_errors.push(err.message));

  for (const route of discoverRoutes()) {
    const inventory = await pageInventory(inventoryPage, route, routeUrl(base, route));
    inventory.links = inventory.links.filter((link) => sameAppUrl(link.href, base));
    pages.push(inventory);
  }
  await inventoryPage.close();

  const seenClicks = new Set();
  for (const page of pages) {
    for (const link of page.links) {
      const key = `${page.route}|${link.text}|${link.href}`;
      if (seenClicks.has(key)) continue;
      seenClicks.add(key);
      click_results.push(await clickVisibleLink(browser, base, page.route, link));
    }
  }

  form_results.push(await submitSearch(browser, base, "/", "#dashboard-search", "Prem", "Prem Bohra"));
  form_results.push(await submitSearch(browser, base, "/search/", "#swfi-search-input", "Real Estate", "Student Quarters"));

  await browser.close();

  const failures = [
    ...pages.filter((page) => !page.status || page.status >= 400).map((page) => ({ type: "page", route: page.route, status: page.status })),
    ...click_results.filter((item) => !item.ok).map((item) => ({ type: "click", ...item })),
    ...form_results.filter((item) => !item.ok).map((item) => ({ type: "form", ...item })),
  ];
  const receipt = {
    origin: base,
    generated_at: new Date().toISOString(),
    status: failures.length || console_errors.length || page_errors.length ? "fail" : "pass",
    summary: {
      pages: pages.length,
      visible_internal_links: click_results.length,
      forms_tested: form_results.length,
      failures: failures.length,
      console_errors: console_errors.length,
      page_errors: page_errors.length,
    },
    pages,
    click_results,
    form_results,
    failures,
    console_errors,
    page_errors,
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
