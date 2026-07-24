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
const detailPath = "src/components/RecordDetailPage.tsx";
const adminPagePath = "src/app/admin/page.tsx";

check("admin_route_exists", fs.existsSync(path.join(repo, routePath)), routePath);
const route = read(routePath);
const admin = read(adminPagePath);
const detail = read(detailPath);

check("admin_people_enrichment_route_disabled", route.includes("notFound()"), "people enrichment admin route is not exposed");
check("admin_nav_does_not_link_enrichment", !admin.includes("/admin/enrichment/people") && !admin.includes("People Enrichment Review"), "admin console does not expose duplicate people profile management");
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
  check("public_admin_route_not_exposed", !html.includes("People Enrichment Review Queue") && !html.includes("people-enrichment-console"), `${url} -> ${res.status}`);
  check("public_admin_route_no_review_queue", !html.includes("People Enrichment Review Queue"), "admin enrichment review UI is not publicly rendered");
}

const failures = checks.filter((item) => item.status !== "pass");
const receipt = {
  generated_at: new Date().toISOString(),
  status: failures.length ? "fail" : "pass",
  scope: "people_enrichment_not_exposed",
  origin: origin || "source_only",
  checks,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));

if (failures.length) process.exit(1);
