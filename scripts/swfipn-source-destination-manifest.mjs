#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "manifests");
const latestReceiptPath = path.join(repoRoot, "output", "swfipn-full-universe-mapping-latest.json");
const latestManifestReceiptPath = path.join(repoRoot, "output", "swfipn-source-destination-manifest-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function text(value) {
  return String(value ?? "").trim();
}


function sourceKindFromRow(row) {
  if (row.family === "news") return "legacy_news";
  if (row.family === "reports") return "report_pdf";
  return "swfi_v1_record";
}

function destinationKind(row) {
  if (/^https:\/\/www\.swfi\.com\/v1\/signin\/\?/i.test(text(row.click_href))) return "swfi_auth_handoff";
  if (text(row.click_href).startsWith(origin)) return "swfipn_internal_route";
  if (/^https?:\/\//i.test(text(row.click_href))) return "external_destination";
  return "missing_destination";
}

function destinationHost(row) {
  try {
    return new URL(text(row.click_href)).hostname;
  } catch {
    return "";
  }
}

function destinationPath(row) {
  try {
    const parsed = new URL(text(row.click_href));
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return text(row.expected_redirect);
  }
}

function normalizeManifestRow(row, sourceFile, lineNumber) {
  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  const failures = Array.isArray(row.failures) ? row.failures : [];
  const expectedRedirect = text(row.expected_redirect);
  const clickHref = text(row.click_href);
  const internalRoute = text(row.internal_route);
  return {
    schema_version: "swfipn.source_destination_manifest.row.v1",
    status: row.ok === true && failures.length === 0 ? "pass" : "fail",
    family: text(row.family),
    collection: text(row.collection),
    source_kind: sourceKindFromRow(row),
    source_id: text(row.id),
    source_label: text(row.label),
    source_url: text(row.source_url),
    source_origin: text(row.source_origin),
    destination_kind: destinationKind(row),
    destination_url: clickHref,
    destination_host: destinationHost(row),
    destination_path: destinationPath(row),
    expected_redirect: expectedRedirect,
    swfipn_destination_url: internalRoute || (clickHref.startsWith(origin) ? clickHref : ""),
    auth_handoff: /^https:\/\/www\.swfi\.com\/v1\/signin\/\?/i.test(clickHref),
    mapping_claim: "source_to_destination_mapping_only",
    parity_claim: "UNPROVEN",
    warnings,
    failures,
    evidence: {
      source_ndjson: sourceFile,
      source_line: lineNumber,
    },
  };
}

function loadMappingReceipt() {
  const receipt = JSON.parse(fs.readFileSync(latestReceiptPath, "utf8"));
  if (receipt.status !== "pass") {
    throw new Error(`Full-universe mapping receipt is not pass: ${receipt.status || "missing"}`);
  }
  if (!Array.isArray(receipt.families) || receipt.families.length === 0) {
    throw new Error("Full-universe mapping receipt has no families.");
  }
  return receipt;
}

async function processFile({ family, filePath, writer, hash }) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const result = {
    family,
    input: filePath,
    rows: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    destination_kinds: {},
    source_kinds: {},
    missing_destination: 0,
    samples: [],
  };
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    const clean = line.trim();
    if (!clean) continue;
    let row;
    try {
      row = JSON.parse(clean);
    } catch (error) {
      row = {
        ok: false,
        family,
        collection: family,
        failures: [`source_ndjson_parse_error:${error.message}`],
      };
    }
    const normalized = normalizeManifestRow(row, filePath, lineNumber);
    const payload = `${JSON.stringify(normalized)}\n`;
    writer.write(payload);
    hash.update(payload);
    result.rows += 1;
    if (normalized.status === "pass") result.passed += 1;
    else result.failed += 1;
    if (normalized.warnings.length) result.warnings += 1;
    if (!normalized.destination_url) result.missing_destination += 1;
    result.destination_kinds[normalized.destination_kind] = (result.destination_kinds[normalized.destination_kind] || 0) + 1;
    result.source_kinds[normalized.source_kind] = (result.source_kinds[normalized.source_kind] || 0) + 1;
    if (result.samples.length < 3) {
      result.samples.push({
        family: normalized.family,
        source_id: normalized.source_id,
        source_url: normalized.source_url,
        destination_kind: normalized.destination_kind,
        destination_url: normalized.destination_url,
        expected_redirect: normalized.expected_redirect,
      });
    }
  }
  return result;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const mapping = loadMappingReceipt();
  const runId = mapping.run_id || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const manifestPath = path.join(outputDir, `swfipn-source-destination-manifest-${runId}.ndjson`);
  const writer = fs.createWriteStream(manifestPath, { encoding: "utf8" });
  const hash = crypto.createHash("sha256");
  const familyResults = [];

  for (const family of mapping.families) {
    const filePath = text(family.output);
    if (!filePath || !fs.existsSync(filePath)) {
      familyResults.push({
        family: text(family.id),
        input: filePath,
        rows: 0,
        passed: 0,
        failed: 1,
        warnings: 0,
        failures: [`missing_family_ndjson:${filePath || "missing"}`],
      });
      continue;
    }
    console.error(`[manifest] ${family.id}: ${filePath}`);
    familyResults.push(await processFile({
      family: text(family.id),
      filePath,
      writer,
      hash,
    }));
  }

  await new Promise((resolve, reject) => {
    writer.end((error) => error ? reject(error) : resolve());
  });

  const totals = familyResults.reduce((acc, item) => {
    acc.rows += item.rows || 0;
    acc.passed += item.passed || 0;
    acc.failed += item.failed || 0;
    acc.warnings += item.warnings || 0;
    acc.missing_destination += item.missing_destination || 0;
    for (const [key, value] of Object.entries(item.destination_kinds || {})) {
      acc.destination_kinds[key] = (acc.destination_kinds[key] || 0) + value;
    }
    for (const [key, value] of Object.entries(item.source_kinds || {})) {
      acc.source_kinds[key] = (acc.source_kinds[key] || 0) + value;
    }
    return acc;
  }, {
    rows: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    missing_destination: 0,
    destination_kinds: {},
    source_kinds: {},
  });

  const receipt = {
    schema_version: "swfipn.source_destination_manifest.v1",
    generated_at: new Date().toISOString(),
    status: totals.failed === 0 && totals.missing_destination === 0 ? "pass" : "fail",
    mapping_receipt: "output/swfipn-full-universe-mapping-latest.json",
    mapping_run_id: runId,
    mapping_scope: mapping.scope || "",
    source_manifest: manifestPath,
    source_manifest_sha256: hash.digest("hex"),
    source_manifest_bytes: fs.statSync(manifestPath).size,
    claim: {
      mapping: "source_to_destination_manifest_created",
      parity: "UNPROVEN",
      note: "This manifest proves source/destination mapping shape only. It does not prove full field parity, exhaustive browser rendering, visual baseline, or adversarial review.",
    },
    totals,
    families: familyResults,
    failures: familyResults.flatMap((item) => item.failures || []),
  };
  fs.writeFileSync(latestManifestReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    rows: totals.rows,
    passed: totals.passed,
    failed: totals.failed,
    missing_destination: totals.missing_destination,
    manifest: manifestPath,
    sha256: receipt.source_manifest_sha256,
    receipt: latestManifestReceiptPath,
    parity: receipt.claim.parity,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(latestManifestReceiptPath, `${JSON.stringify({
    schema_version: "swfipn.source_destination_manifest.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    error: error.message,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
