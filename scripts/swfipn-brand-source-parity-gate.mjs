import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const origin = (process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/").replace(/\/?$/, "/");
const outDir = path.resolve("output");

const specs = [
  {
    id: "about",
    route: "/about/",
    alias: "/about-us/overview/",
    source: "https://www.swfi.com/about-us/overview",
    requiredText: [
      "Who Are We?",
      "SWFI® is a platform offering comprehensive research & analysis of global capital",
      "The Sovereign Wealth Fund Institute was originally conceived in 2007",
    ],
    structure: "about",
  },
  {
    id: "our-team",
    route: "/about-us/our-team/",
    source: "https://www.swfi.com/about-us/our-team",
    requiredText: [
      "Our Team",
      "Lakshmi Narayanan",
      "Michael Maduell",
      "Kong Posh Bhat",
      "Ajay Thota",
    ],
    structure: "team",
  },
  {
    id: "solutions",
    route: "/solutions/",
    source: "https://www.swfi.com/solutions",
    requiredText: [
      "Fundraising & Finding Buyers",
      "Industry Intelligence & Rankings",
      "Due Diligence & KYC",
      "Investor Benchmarking",
    ],
    structure: "solutions",
  },
  {
    id: "demo",
    route: "/demo/",
    source: "https://www.swfi.com/demo",
    requiredText: ["Request a Demo", "First name", "Business type", "Corporate email"],
    structure: "form",
    compareSelects: ["businessType", "country"],
  },
  {
    id: "contact",
    route: "/contact/",
    source: "https://www.swfi.com/contact-us",
    requiredText: ["Contact Us", "Name", "How did you find us?", "support@swfinstitute.org"],
    structure: "form",
    compareSelects: ["country", "referral"],
  },
  {
    id: "newsletter-subscription",
    route: "/newsletter-subscription/",
    source: "https://www.swfi.com/newsletter-subscription",
    requiredText: ["Subscribe to Our Newsletter", "Email", "Subscribe"],
    structure: "public-text",
    minSourceTextLength: 40,
  },
  {
    id: "privacy-policy",
    route: "/privacy-policy/",
    source: "https://www.swfi.com/privacy-policy",
    requiredText: ["Privacy Policy", "What we collect", "Sensitive personal information", "Consent"],
    structure: "public-text",
    minSourceTextLength: 12_000,
  },
  {
    id: "terms-of-use",
    route: "/terms-of-use/",
    source: "https://www.swfi.com/terms-of-use",
    requiredText: ["Terms of Use", "Last updated: November 10, 2022.", "1. General information", "16. Email alerts and newsletters"],
    structure: "public-text",
    minSourceTextLength: 20_000,
  },
  {
    id: "cookie-policy",
    route: "/cookie-policy/",
    source: "https://www.swfi.com/cookie-policy",
    requiredText: ["Cookie Policy", "What is a cookie?", "Cookies we may use and why?", "Changes to this cookie notice"],
    structure: "public-text",
    minSourceTextLength: 5_000,
  },
  {
    id: "accessibility",
    route: "/accessibility/",
    source: "https://www.swfi.com/accessibility",
    requiredText: ["Accessibility Statement", "Accessibility on www.swfi.com", "Enabling accessibility menu"],
    structure: "public-text",
    minSourceTextLength: 900,
  },
];

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).toString();
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ").trim();
    const anchors = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
    }));
    const images = Array.from(document.images).map((img) => ({
      alt: img.alt,
      src: img.currentSrc || img.src,
      width: img.clientWidth,
      height: img.clientHeight,
    })).filter((img) => img.width || img.height);
    const selects = Object.fromEntries(Array.from(document.querySelectorAll("select")).map((select) => [
      select.name || select.id || "unnamed",
      Array.from(select.options).map((option) => option.textContent?.trim().replace(/\s+/g, " ") || "").filter(Boolean),
    ]));
    const yearAnchors = anchors.filter((link) => /^(2007|2008|2010|2012|2013|2014|2016|2017|2019|2020|2021|2022|2023)$/.test(link.text));
    const timelineButtons = Array.from(document.querySelectorAll("[data-swfi-timeline] button, label[role='button']")).map((el) => el.textContent?.trim() || "");
    return { url: location.href, title: document.title, text, anchors, images, selects, yearAnchors, timelineButtons };
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripPublicChromeText(value) {
  return normalizeText(value)
    .replace(/^About Us Solutions Demo Contact Us Sign In\s+/, "")
    .replace(/\s+About Us Solutions Demo Contact Us Subscribe Sign In © 2008-2023 Sovereign Wealth Fund Institute \| All rights reserved Privacy Policy Terms of Use Cookie Policy Accessibility Statement$/, "")
    .trim();
}

async function checkSpec(browser, spec) {
  const result = {
    id: spec.id,
    route: spec.route,
    alias: spec.alias || null,
    source: spec.source,
    ok: true,
    failures: [],
    screenshots: {},
    facts: {},
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const sourcePage = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    const response = await page.goto(appUrl(spec.route), { waitUntil: "networkidle", timeout: 60_000 });
    if (!response || response.status() >= 400) result.failures.push(`internal_http_${response?.status() || "missing"}`);
    const sourceResponse = await sourcePage.goto(spec.source, { waitUntil: "networkidle", timeout: 90_000 });
    if (!sourceResponse || sourceResponse.status() >= 400) result.failures.push(`source_http_${sourceResponse?.status() || "missing"}`);
    await page.waitForTimeout(500);
    await sourcePage.waitForTimeout(500);
    const internal = await pageFacts(page);
    const source = await pageFacts(sourcePage);
    result.facts.internal = summarizeFacts(internal);
    result.facts.source = summarizeFacts(source);

    for (const required of spec.requiredText) {
      if (!internal.text.includes(required)) result.failures.push(`internal_missing_text:${required.slice(0, 80)}`);
      if (!source.text.includes(required)) result.failures.push(`source_missing_text:${required.slice(0, 80)}`);
    }
    if (/Smart Search Bar/i.test(internal.text)) result.failures.push("brand_page_has_terminal_search_bar");
    if (internal.text.includes("Source gap") || internal.text.includes("Active Mirror")) result.failures.push("brand_page_internal_leakage");

    if (spec.alias) {
      const aliasPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      try {
        const aliasResponse = await aliasPage.goto(appUrl(spec.alias), { waitUntil: "networkidle", timeout: 45_000 });
        if (!aliasResponse || aliasResponse.status() >= 400) result.failures.push(`alias_http_${aliasResponse?.status() || "missing"}`);
        const aliasFacts = await pageFacts(aliasPage);
        if (!aliasFacts.text.includes(spec.requiredText[0])) result.failures.push("alias_missing_primary_text");
      } finally {
        await aliasPage.close().catch(() => {});
      }
    }

    if (spec.structure === "about") {
      const sourceYearCount = source.timelineButtons.filter(Boolean).length;
      const internalYearCount = internal.timelineButtons.filter(Boolean).length;
      if (sourceYearCount !== 13) result.failures.push(`source_timeline_count_${sourceYearCount}`);
      if (internalYearCount !== sourceYearCount) result.failures.push(`timeline_count_mismatch:source_${sourceYearCount}:internal_${internalYearCount}`);
      if (internal.yearAnchors.length) result.failures.push(`year_anchors_should_not_exist:${internal.yearAnchors.map((link) => link.text).join(",")}`);
      if (!internal.images.some((img) => img.alt === "about-us-banner")) result.failures.push("missing_about_banner");
      await page.getByRole("button", { name: "2023" }).click({ timeout: 10_000 }).catch((error) => result.failures.push(`timeline_click_failed:${error.message}`));
      const afterClick = await pageFacts(page);
      if (!afterClick.text.includes("Sovereign Investor Leadership Conference")) result.failures.push("timeline_2023_tooltip_missing");
    }

    if (spec.structure === "solutions") {
      const sourceSolutionImages = source.images.filter((img) => img.alt === "solution").length;
      const internalSolutionImages = internal.images.filter((img) => img.alt === "solution").length;
      if (sourceSolutionImages !== 7) result.failures.push(`source_solution_image_count_${sourceSolutionImages}`);
      if (internalSolutionImages !== sourceSolutionImages) result.failures.push(`solution_image_count_mismatch:source_${sourceSolutionImages}:internal_${internalSolutionImages}`);
      const requestDemoLinks = internal.anchors.filter((link) => /^Request a demo$/i.test(link.text)).length;
      if (requestDemoLinks !== 7) result.failures.push(`request_demo_link_count_${requestDemoLinks}`);
    }

    if (spec.structure === "team") {
      const sourceTeamImages = source.images.filter((img) => /teams\//i.test(img.src) || /\.webp$/i.test(img.alt || "")).length;
      const internalTeamImages = internal.images.filter((img) => /teams\//i.test(img.src)).length;
      if (sourceTeamImages !== 8) result.failures.push(`source_team_image_count_${sourceTeamImages}`);
      if (internalTeamImages !== sourceTeamImages) result.failures.push(`team_image_count_mismatch:source_${sourceTeamImages}:internal_${internalTeamImages}`);
      for (const name of ["Lakshmi Narayanan", "Michael Maduell", "Karen Maduell", "Kong Posh Bhat", "Edward Longhurst-Pierce", "Kim S. Diamond", "Dipika Patel", "Ajay Thota"]) {
        if (!internal.text.includes(name)) result.failures.push(`team_member_missing:${name}`);
      }
    }

    if (spec.structure === "public-text") {
      const sourceArticle = stripPublicChromeText(source.text);
      const internalText = normalizeText(internal.text);
      if (sourceArticle.length < spec.minSourceTextLength) result.failures.push(`source_text_length_${sourceArticle.length}_lt_${spec.minSourceTextLength}`);
      if (!internalText.includes(sourceArticle)) {
        result.failures.push(`internal_missing_source_article_text:length_${sourceArticle.length}`);
      }
      result.facts.source.article_text_length = sourceArticle.length;
      result.facts.internal.article_text_covered = internalText.includes(sourceArticle);
    }

    for (const name of spec.compareSelects || []) {
      const sourceOptions = source.selects[name] || [];
      const internalOptions = internal.selects[name] || [];
      if (!sourceOptions.length) result.failures.push(`source_select_missing:${name}`);
      if (sourceOptions.length !== internalOptions.length) result.failures.push(`select_count_mismatch:${name}:source_${sourceOptions.length}:internal_${internalOptions.length}`);
    }

    const internalShot = path.join(outDir, `brand-source-parity-${spec.id}-internal.png`);
    const sourceShot = path.join(outDir, `brand-source-parity-${spec.id}-source.png`);
    await page.screenshot({ path: internalShot, fullPage: true });
    await sourcePage.screenshot({ path: sourceShot, fullPage: true });
    result.screenshots.internal = internalShot;
    result.screenshots.source = sourceShot;
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
    await sourcePage.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function summarizeFacts(facts) {
  return {
    url: facts.url,
    title: facts.title,
    image_count: facts.images.length,
    timeline_count: facts.timelineButtons.length,
    year_anchor_count: facts.yearAnchors.length,
    select_counts: Object.fromEntries(Object.entries(facts.selects).map(([key, value]) => [key, value.length])),
    first_links: facts.anchors.slice(0, 12),
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const spec of specs) {
      console.log(`[brand-source-parity] ${spec.id} ${spec.route}`);
      results.push(await checkSpec(browser, spec));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const receipt = {
    status: results.every((result) => result.ok) ? "pass" : "fail",
    checked_at: new Date().toISOString(),
    origin,
    results,
  };
  const latest = path.join(outDir, "swfipn-brand-source-parity-latest.json");
  fs.writeFileSync(latest, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, receipt: latest, failures: results.flatMap((result) => result.failures.map((failure) => `${result.id}:${failure}`)) }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
