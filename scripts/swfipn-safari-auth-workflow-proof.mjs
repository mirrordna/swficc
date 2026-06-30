#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-safari-auth-workflow-proof-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");

const cases = [
  {
    id: "filtered_profile_row_handoff",
    kind: "swfipn_link_extraction",
    startUrl: new URL("profiles/?filter=GC1%20Ventures", origin).href,
    linkText: "GC1 Ventures",
    expectedHref: "https://www.swfi.com/v1/signin/?msg=auth&redirect=%2Fv1%2Fentities%2F5e39a581fcbe7e8ca723278c",
    expectedText: "GC1 Ventures",
  },
  {
    id: "entity_record_lands_authenticated",
    kind: "swfi_record",
    url: "https://www.swfi.com/v1/entities/5e39a581fcbe7e8ca723278c",
    expectedPath: "/v1/entities/5e39a581fcbe7e8ca723278c",
    expectedText: "GC1 Ventures",
  },
  {
    id: "allocator_entity_record_lands_authenticated",
    kind: "swfi_record",
    url: "https://www.swfi.com/v1/entities/5bb7bec0ca00a5212c486ec2",
    expectedPath: "/v1/entities/5bb7bec0ca00a5212c486ec2",
    expectedText: "Andreessen Horowitz",
  },
  {
    id: "person_record_lands_authenticated",
    kind: "swfi_record",
    url: "https://www.swfi.com/v1/people/6511322707d1eae2780c9b9a",
    expectedPath: "/v1/people/6511322707d1eae2780c9b9a",
    expectedText: "Marjorie Hebert",
  },
  {
    id: "transaction_record_lands_authenticated",
    kind: "swfi_record",
    url: "https://www.swfi.com/v1/transactions/6a3d33e6edf2330f3c87f777",
    expectedPath: "/v1/transactions/6a3d33e6edf2330f3c87f777",
    expectedText: "Andreessen",
  },
  {
    id: "compass_record_lands_authenticated",
    kind: "swfi_record",
    url: "https://www.swfi.com/v1/compass/69b8dea0dd82ad96bceeb86a",
    expectedPath: "/v1/compass/69b8dea0dd82ad96bceeb86a",
    expectedText: "CalPERS",
  },
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function escapeAppleString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function runOsa(lines) {
  const args = [];
  for (const line of lines) args.push("-e", line);
  const result = spawnSync("osascript", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `osascript exited ${result.status}`).trim());
  }
  return result.stdout.trim();
}

function safariEval(js) {
  return runOsa([
    'tell application "Safari"',
    `do JavaScript "${escapeAppleString(js)}" in front document`,
    "end tell",
  ]);
}

function currentSafariUrl() {
  return runOsa([
    'tell application "Safari"',
    'if (count of documents) is 0 then return ""',
    "return URL of front document",
    "end tell",
  ]);
}

function safariOpen(url) {
  const previousUrl = currentSafariUrl();
  runOsa([
    'tell application "Safari"',
    "activate",
    "if (count of documents) is 0 then make new document",
    `set URL of front document to "${escapeAppleString(url)}"`,
    "end tell",
  ]);
  return previousUrl;
}

function captureScreen(id) {
  const screenshot = path.join(outputDir, `swfipn-safari-auth-workflow-${id}.png`);
  const result = spawnSync("screencapture", ["-x", screenshot], { encoding: "utf8" });
  return result.status === 0 && fs.existsSync(screenshot) ? screenshot : "";
}

async function waitForPage({ previousUrl = "", expectedUrl = "", timeoutMs = 45_000 } = {}) {
  const started = Date.now();
  let last = {};
  while (Date.now() - started < timeoutMs) {
    try {
      const raw = safariEval(`JSON.stringify({ready:document.readyState,url:location.href,title:document.title,text:document.body ? document.body.innerText.slice(0,12000) : ""})`);
      last = JSON.parse(raw);
      const leftPreviousPage = !previousUrl || last.url !== previousUrl;
      const reachedExpectedPage = !expectedUrl || normalizeComparableUrl(last.url) === normalizeComparableUrl(expectedUrl);
      if (last.ready === "complete" && last.url && last.text !== undefined && leftPreviousPage && reachedExpectedPage) return last;
    } catch (error) {
      last = { error: error.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

async function waitForJsValue(js, predicate, timeoutMs = 90_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      last = safariEval(js);
      if (predicate(last)) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/\/$/, "");
  }
}

function bodyLooksLikeSignin(text) {
  return /Subscriber Sign In|Sign in|Sign In|Email Address|Password/i.test(String(text || ""));
}

function bodyLooksLikeError(text) {
  return /404|Not Found|Web server is down|Error code 521|Access denied|Forbidden/i.test(String(text || ""));
}

async function runLinkExtraction(testCase) {
  const previousUrl = safariOpen(testCase.startUrl);
  const page = await waitForPage({ previousUrl, expectedUrl: testCase.startUrl });
  const linkJs = `(() => {
    const needle = ${JSON.stringify(testCase.linkText)};
    const link = Array.from(document.querySelectorAll("a[href]")).find((a) => (a.textContent || "").includes(needle));
    return link ? link.href : "";
  })()`;
  const href = await waitForJsValue(linkJs, (value) => Boolean(value), 90_000);
  const hydratedText = safariEval("document.body ? document.body.innerText.slice(0,12000) : ''");
  const screenshot = captureScreen(testCase.id);
  const failures = [];
  if (href !== testCase.expectedHref) failures.push(`expected_href_mismatch:${href || "missing"}`);
  if (!String(hydratedText || "").includes(testCase.expectedText)) failures.push(`expected_row_text_missing:${testCase.expectedText}`);
  return {
    id: testCase.id,
    kind: testCase.kind,
    status: failures.length ? "FAIL" : "PASS",
    tested_url: testCase.startUrl,
    expected_href: testCase.expectedHref,
    actual_href: href,
    final_url: page.url || "",
    expected_text: testCase.expectedText,
    actual_title: page.title || "",
    body_excerpt: String(hydratedText || page.text || "").slice(0, 700).replace(/\s+/g, " "),
    screenshot,
    failures,
  };
}

async function runRecordLanding(testCase) {
  const previousUrl = safariOpen(testCase.url);
  const page = await waitForPage({ previousUrl, expectedUrl: testCase.url });
  const screenshot = captureScreen(testCase.id);
  const failures = [];
  let finalPath = "";
  try {
    finalPath = new URL(page.url || "").pathname.replace(/\/$/, "");
  } catch {
    failures.push(`invalid_final_url:${page.url || "missing"}`);
  }
  if (finalPath !== testCase.expectedPath) failures.push(`expected_path_mismatch:${finalPath || "missing"}`);
  if (bodyLooksLikeSignin(page.text)) failures.push("landed_on_signin_or_auth_form");
  if (bodyLooksLikeError(page.text)) failures.push("landed_on_error_page");
  if (!String(page.text || "").toLowerCase().includes(testCase.expectedText.toLowerCase())) {
    failures.push(`expected_record_text_missing:${testCase.expectedText}`);
  }
  return {
    id: testCase.id,
    kind: testCase.kind,
    status: failures.length ? "FAIL" : "PASS",
    tested_url: testCase.url,
    expected_path: testCase.expectedPath,
    final_url: page.url || "",
    expected_text: testCase.expectedText,
    actual_title: page.title || "",
    body_excerpt: String(page.text || "").slice(0, 900).replace(/\s+/g, " "),
    screenshot,
    failures,
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  let safariAvailable = true;
  try {
    runOsa([
      'tell application "Safari"',
      'if (count of documents) is 0 then make new document',
      "return URL of front document",
      "end tell",
    ]);
  } catch (error) {
    safariAvailable = false;
    results.push({
      id: "safari_automation_available",
      status: "BLOCKED",
      failures: [error.message],
    });
  }

  if (safariAvailable) {
    for (const testCase of cases) {
      try {
        results.push(testCase.kind === "swfipn_link_extraction"
          ? await runLinkExtraction(testCase)
          : await runRecordLanding(testCase));
      } catch (error) {
        results.push({
          id: testCase.id,
          kind: testCase.kind,
          status: "BLOCKED",
          tested_url: testCase.startUrl || testCase.url,
          failures: [error.message],
          screenshot: captureScreen(testCase.id),
        });
      }
    }
  }

  const failures = results.filter((row) => row.status === "FAIL");
  const blockers = results.filter((row) => row.status === "BLOCKED");
  const receipt = {
    schema_version: "swfipn.safari_auth_workflow_proof.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    summary: {
      checks: results.length,
      pass: results.filter((row) => row.status === "PASS").length,
      fail: failures.length,
      blocked: blockers.length,
    },
    note: "Uses the currently logged-in Safari session. No password is printed, stored, or embedded.",
    results,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "blocked", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
