import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-domain-readiness-latest.json");
const targetHost = normalizeHost(process.env.SWFIPN_DASHBOARD_DOMAIN || "dashboard.swfi.com");
const currentHost = normalizeHost(process.env.SWFIPN_CURRENT_DOMAIN || "swfipn.activemirror.ai");
const allowedOriginIp = String(process.env.SWFIPN_ORIGIN_IP || "").trim();
const dnsResolvers = String(process.env.SWFIPN_DNS_RESOLVERS || "1.1.1.1,9.9.9.9,8.8.8.8")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
if (dnsResolvers.length) dns.setServers(dnsResolvers);

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

async function resolveA(host) {
  try {
    return await dns.resolve4(host);
  } catch (error) {
    return { error: error.code || error.message };
  }
}

async function resolveCname(host) {
  try {
    return await dns.resolveCname(host);
  } catch (error) {
    return { error: error.code || error.message };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const targetA = await resolveA(targetHost);
const currentA = await resolveA(currentHost);
const targetCname = await resolveCname(targetHost);

const reasons = [];
if (!targetHost) reasons.push("missing_target_host");
if (targetHost.endsWith(".swif.com")) reasons.push("target_looks_like_swfi_typo_swif_com");
if (!Array.isArray(targetA) || targetA.length === 0) reasons.push("target_has_no_a_record");

const cnameTargetsCurrent = asArray(targetCname).some((item) => item.replace(/\.$/, "") === currentHost);
const aRecordOverlap = asArray(targetA).some((ip) => asArray(currentA).includes(ip));
const pointsAtOrigin = Boolean(allowedOriginIp && asArray(targetA).includes(allowedOriginIp));
if (!cnameTargetsCurrent && !aRecordOverlap && !pointsAtOrigin) {
  reasons.push("target_dns_does_not_point_to_current_dashboard_stack");
}

const receipt = {
  schema_version: "swfipn.domain_readiness_gate.v1",
  generated_at: new Date().toISOString(),
  status: reasons.length === 0 ? "pass" : "blocked",
  target_host: targetHost,
  current_host: currentHost,
  expected_app_url: `https://${targetHost}/swficc/`,
  dns: {
    resolvers: dnsResolvers,
    target_a: targetA,
    target_cname: targetCname,
    current_a: currentA,
    allowed_origin_ip: allowedOriginIp || null,
  },
  checks: {
    cname_targets_current: cnameTargetsCurrent,
    a_record_overlap: aRecordOverlap,
    points_at_origin: pointsAtOrigin,
  },
  blockers: reasons,
  next_dns_action:
    reasons.length === 0
      ? ""
      : `Create dashboard DNS for ${targetHost} as a CNAME to ${currentHost} or an A record to the approved dashboard edge before deploying this host.`,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, target_host: targetHost, blockers: reasons, receipt: receiptPath }, null, 2));
if (receipt.status !== "pass") process.exit(1);
