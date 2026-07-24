#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, "swfipn-phase2-closure-packet-latest.json");
const mdPath = path.join(outputDir, "swfipn-phase2-closure-packet-latest.md");

const receipts = {
  acceptanceLock: readJson("output/swfipn-acceptance-lock-latest.json"),
  runtime: readJson("output/swfipn-runtime-staleness-gate-latest.json"),
  phase2: readJson("output/swfipn-brd-phase2-acceptance-latest.json"),
  runtimePreflight: readJson("output/swfipn-phase2-runtime-preflight-latest.json"),
  dnsCutover: readJson("output/swfipn-api-dns-cutover-latest.json"),
  dnsGate: readJson("output/swfipn-api-dns-key-lifecycle-latest.json"),
  sendgridGate: readJson("output/swfipn-sendgrid-email-brd-gate-latest.json"),
  bridgeGate: readJson("output/swfipn-swfi-session-bridge-brd-gate-latest.json"),
  shareGate: readJson("output/swfipn-share-gate-latest.json"),
};

const deployRelease = receipts.runtime?.deploy_receipt?.release || receipts.runtime?.release || "unknown";
const assetVersion = receipts.runtime?.public_release_marker?.asset_version || receipts.runtime?.asset_version || "unknown";
const dnsRollback = receipts.dnsCutover?.rollback || {};
const dnsCurrentRecord = receipts.dnsCutover?.current_record || {};
const runtimeSummary = receipts.runtimePreflight?.summary || {};
const dnsSummary = receipts.dnsGate?.summary || {};

const packet = {
  schema_version: "swfipn.phase2_closure_packet.v1",
  generated_at: new Date().toISOString(),
  status: "blocked_waiting_on_external_runtime_inputs",
  public_url: "https://swfipn.activemirror.ai/swficc/",
  deployed_release: deployRelease,
  public_asset_version: assetVersion,
  current_acceptance_verdict: receipts.acceptanceLock?.final_verdict || "unknown",
  current_scope_sendable: Boolean(receipts.shareGate?.sendable),
  no_secret_values_written: true,
  closure_tracks: [
    dnsTrack(),
    sendgridTrack(),
    sessionBridgeTrack(),
  ],
  final_verification_commands: [
    "npm run runtime:phase2:preflight:public",
    "npm run brd:api-dns:gate:public",
    "npm run brd:sendgrid-email:gate:public",
    "npm run brd:swfi-session:gate:public",
    "npm run brd:phase2:gate:public",
    "npm run acceptance-lock",
    "npm run loop-collapse",
  ],
  receipts_used: Object.fromEntries(Object.entries(receipts).map(([key, value]) => [key, Boolean(value)])),
};

fs.writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`);
fs.writeFileSync(mdPath, renderMarkdown(packet));
console.log(JSON.stringify({ status: packet.status, json: jsonPath, markdown: mdPath }, null, 2));

function dnsTrack() {
  const currentIp = dnsCurrentRecord.data || dnsSummary.actual_dns_a_records?.[0] || "67.207.93.157";
  const targetIp = receipts.dnsCutover?.preflight?.target_data || dnsSummary.expected_dns_a_records?.[0] || "161.35.56.218";
  return {
    id: "api_dns_cutover",
    status: receipts.dnsCutover?.status || "unknown",
    owner_needed: "DigitalOcean operator with DNS write permission for swfi.com",
    current_evidence: {
      record_id: dnsCurrentRecord.id || dnsRollback.record_id || null,
      current_a_record: currentIp,
      target_a_record: targetIp,
      apply_result: receipts.dnsCutover?.apply_result || null,
      blocker: receipts.dnsCutover?.blockers?.[0] || dnsSummary.blockers?.[0] || "unknown",
    },
    apply_command: "SWFIPN_API_DNS_APPLY=1 npm run brd:api-dns:cutover",
    manual_fallback_steps: [
      "Open DigitalOcean Networking / Domains / swfi.com.",
      `Edit A record "api" from ${currentIp} to ${targetIp}.`,
      `Keep TTL ${dnsRollback.previous_ttl || dnsCurrentRecord.ttl || 3600}.`,
      "Do not change root, www, MX, TXT, or other records.",
    ],
    rollback: {
      record_id: dnsRollback.record_id || dnsCurrentRecord.id || null,
      restore_data: dnsRollback.previous_data || currentIp,
      restore_ttl: dnsRollback.previous_ttl || dnsCurrentRecord.ttl || 3600,
    },
    proof_commands: [
      "dig +short api.swfi.com A",
      "npm run brd:api-dns:gate:public",
    ],
    pass_condition: "api.swfi.com resolves to 161.35.56.218 and the production API DNS/key lifecycle gate passes.",
  };
}

function sendgridTrack() {
  return {
    id: "sendgrid_email_delivery",
    status: receipts.sendgridGate?.status || "unknown",
    owner_needed: "SWFI email/SendGrid owner",
    current_evidence: {
      blockers: receipts.sendgridGate?.blockers || [],
      runtime_preflight_blockers: (runtimeSummary.blockers || []).filter((item) => item.includes("sendgrid")),
      local_swfi_sendgrid_candidate_present: Boolean(runtimeSummary.local_swfi_sendgrid_candidate_present),
      local_non_contract_sendgrid_candidate_present: Boolean(runtimeSummary.local_non_contract_sendgrid_candidate_present),
    },
    required_values: [
      "SWFI2_SENDGRID_API_KEY or SENDGRID_API_KEY",
      "SWFI2_SENDGRID_FROM_EMAIL or SENDGRID_FROM_EMAIL",
      "SWFI2_SENDGRID_FROM_NAME, recommended: SWFI",
    ],
    apply_command_template: [
      "SWFIPN_HOST=swfipn-do \\",
      "SWFI2_SENDGRID_API_KEY=\"<sendgrid-api-key>\" \\",
      "SWFI2_SENDGRID_FROM_EMAIL=\"<from-email>\" \\",
      "SWFI2_SENDGRID_FROM_NAME=\"SWFI\" \\",
      "SWFIPN_RESTART=1 \\",
      "npm run runtime:config:apply",
    ].join("\n"),
    guardrails: [
      "Do not use the SWFSUMMIT SendGrid key as SWFI proof.",
      "Do not enable sandbox mode for the final delivery receipt.",
      "Do not paste the API key into a shell history file or committed env file.",
    ],
    proof_commands: [
      "npm run runtime:phase2:preflight:public",
      "npm run brd:sendgrid-email:gate:public",
    ],
    pass_condition: "SendGrid gate returns pass with email_delivery_claimed=true and sendgrid_onboarding_claimed=true.",
  };
}

function sessionBridgeTrack() {
  return {
    id: "swfi_session_bridge",
    status: receipts.bridgeGate?.status || "unknown",
    owner_needed: "SWFI auth/platform owner",
    current_evidence: {
      blockers: receipts.bridgeGate?.blockers || [],
      runtime_preflight_blockers: (runtimeSummary.blockers || []).filter((item) => item.includes("bridge") || item.includes("signin")),
    },
    required_values: [
      "SWFIPN_SWFI_SESSION_BRIDGE_SECRET",
      "SWFIPN_SWFI_SESSION_BRIDGE_ISSUER=swfi.com",
      "SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE=https://swfipn.activemirror.ai/swficc/",
      "SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED=1",
      "SWFI sign-in must return a signed assertion to /swficc/auth/bridge/?next=...",
    ],
    assertion_contract: {
      accepted_formats: ["payload.signature", "header.payload.signature"],
      required_payload_fields: ["sub or email/user_id", "exp"],
      recommended_payload_fields: ["iss=swfi.com", "aud=https://swfipn.activemirror.ai/swficc/", "iat", "roles"],
      signature: "HMAC SHA-256 over the base64url payload using the shared bridge secret.",
    },
    apply_command_template: [
      "SWFIPN_HOST=swfipn-do \\",
      "SWFIPN_SWFI_SESSION_BRIDGE_SECRET=\"$SWFI_BRIDGE_SECRET\" \\",
      "SWFIPN_SWFI_SESSION_BRIDGE_ISSUER=\"swfi.com\" \\",
      "SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE=\"https://swfipn.activemirror.ai/swficc/\" \\",
      "SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED=1 \\",
      "SWFIPN_RESTART=1 \\",
      "npm run runtime:config:apply",
    ].join("\n"),
    proof_commands: [
      "npm run runtime:phase2:preflight:public",
      "npm run brd:swfi-session:gate:public",
    ],
    pass_condition: "SWFI session bridge gate passes with real_swfi_auth_integration_claimed=true and no bridge blockers.",
  };
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, relPath), "utf8"));
  } catch {
    return null;
  }
}

function renderMarkdown(data) {
  const lines = [];
  lines.push("# SWFIPN Phase 2 Closure Packet", "");
  lines.push(`Generated: ${data.generated_at}`);
  lines.push(`Public URL: ${data.public_url}`);
  lines.push(`Deployed release: ${data.deployed_release}`);
  lines.push(`Asset version: ${data.public_asset_version}`);
  lines.push(`Acceptance verdict: ${data.current_acceptance_verdict}`);
  lines.push(`Current scope sendable: ${data.current_scope_sendable}`);
  lines.push("", "This packet contains no secret values.", "");
  for (const track of data.closure_tracks) {
    lines.push(`## ${track.id}`, "");
    lines.push(`Status: ${track.status}`);
    lines.push(`Owner needed: ${track.owner_needed}`, "");
    lines.push("### Current Evidence", "");
    lines.push("```json");
    lines.push(JSON.stringify(track.current_evidence, null, 2));
    lines.push("```", "");
    if (track.required_values) {
      lines.push("### Required Values", "");
      for (const item of track.required_values) lines.push(`- \`${item}\``);
      lines.push("");
    }
    if (track.manual_fallback_steps) {
      lines.push("### Manual Fallback", "");
      for (const item of track.manual_fallback_steps) lines.push(`- ${item}`);
      lines.push("");
    }
    if (track.rollback) {
      lines.push("### Rollback", "");
      lines.push("```json");
      lines.push(JSON.stringify(track.rollback, null, 2));
      lines.push("```", "");
    }
    if (track.assertion_contract) {
      lines.push("### Assertion Contract", "");
      lines.push("```json");
      lines.push(JSON.stringify(track.assertion_contract, null, 2));
      lines.push("```", "");
    }
    if (track.guardrails) {
      lines.push("### Guardrails", "");
      for (const item of track.guardrails) lines.push(`- ${item}`);
      lines.push("");
    }
    lines.push("### Apply Command", "");
    lines.push("```bash");
    lines.push(track.apply_command || track.apply_command_template);
    lines.push("```", "");
    lines.push("### Proof Commands", "");
    lines.push("```bash");
    lines.push(track.proof_commands.join("\n"));
    lines.push("```", "");
    lines.push(`Pass condition: ${track.pass_condition}`, "");
  }
  lines.push("## Final Verification", "", "```bash");
  lines.push(data.final_verification_commands.join("\n"));
  lines.push("```", "");
  lines.push("Do not claim full BRD Phase 2 complete until every final verification command passes and acceptance-lock no longer reports deferred runtime blockers.", "");
  return `${lines.join("\n")}\n`;
}
