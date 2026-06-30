#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repo = process.cwd();
const origin = (process.env.SWFIPN_ORIGIN || "").replace(/\/$/, "");
const outputPath = path.join(repo, "output", "swfipn-people-enrichment-demo-gate-latest.json");

const checks = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repo, relativePath), "utf8");
}

function check(id, pass, detail) {
  checks.push({ id, status: pass ? "pass" : "fail", detail });
}

const routePath = "src/app/admin/enrichment/people/page.tsx";
const componentPath = "src/components/PeopleEnrichmentConsole.tsx";
const libPath = "src/lib/peopleEnrichment.ts";
const detailPath = "src/components/RecordDetailPage.tsx";

check("admin_route_exists", fs.existsSync(path.join(repo, routePath)), routePath);
check("admin_console_exists", fs.existsSync(path.join(repo, componentPath)), componentPath);
check("enrichment_library_exists", fs.existsSync(path.join(repo, libPath)), libPath);

const component = read(componentPath);
const lib = read(libPath);
const detail = read(detailPath);

check("admin_queue_has_receipt", component.includes("people-enrichment-receipt"), "admin review emits a browser-session decision receipt");
check("admin_queue_has_approve_reject", component.includes("Approve") && component.includes("Reject"), "admin queue exposes bounded review decisions");
check("candidate_copy_is_review_only", component.includes("Candidate links are review-only until approved"), "admin page states candidates are not published");
check("no_mongo_write_claim", component.includes("does not write to MongoDB"), "admin page states demo does not mutate MongoDB");
check("statuses_defined", ["pending", "candidate_found", "high_confidence", "needs_review", "verified", "rejected"].every((status) => lib.includes(status)), "governed statuses present");
check("public_detail_uses_verified_links", detail.includes("verifiedPeopleLinks(record, sourceUrl)") && detail.includes("Verified Public Links"), "public person detail only renders verified link helper output");

const personRecordMatch = detail.match(/function PersonRecord[\s\S]*?function VerifiedPeopleLinks/);
const personRecordSource = personRecordMatch?.[0] || "";
check(
  "public_detail_no_candidate_language",
  !/candidate_found|high_confidence|needs_review|review-only|candidate search/i.test(personRecordSource),
  "public PersonRecord does not expose admin candidate-review language",
);

if (origin) {
  const url = `${origin}/admin/enrichment/people/`;
  const res = await fetch(url, { headers: { Accept: "text/html" } }).catch((error) => ({ ok: false, status: 0, error }));
  const html = "text" in res ? await res.text() : "";
  check("public_admin_route_http", Boolean(res.ok), `${url} -> ${res.status}`);
  check("public_admin_route_content", html.includes("People Enrichment Review Queue"), "admin route includes review queue title");
}

const failures = checks.filter((item) => item.status !== "pass");
const receipt = {
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  scope: "people_enrichment_demo",
  origin: origin || "source_only",
  checks,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));

if (failures.length) process.exit(1);
