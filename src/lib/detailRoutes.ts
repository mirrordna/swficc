import { text } from "@/lib/sourcePackets";
import { isAllowedSwfiHost, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";

type Row = Record<string, unknown>;
export type DashboardDetailType =
  | "entity"
  | "institution"
  | "investor"
  | "allocator"
  | "profile"
  | "rfp"
  | "mandate"
  | "transaction"
  | "deal"
  | "fundraising"
  | "person"
  | "research"
  | "compare";

type DashboardDetailOptions = {
  sourceUrl?: string;
  label?: string;
  slug?: string;
  left?: string;
  right?: string;
};

export function sourceRecordId(sourceUrl: string | undefined): string {
  return parseSwfiRecordSource(sourceUrl).id;
}

type SwfiRecordSource = {
  section: "entities" | "people" | "transactions" | "compass" | "";
  id: string;
};
type SwfiSection = Exclude<SwfiRecordSource["section"], "">;

export function sourceRecordIdFor(sourceUrl: string | undefined, section: SwfiSection): string {
  const source = parseSwfiRecordSource(sourceUrl);
  return source.section === section ? source.id : "";
}

export function parseSwfiRecordSource(sourceUrl: string | undefined): SwfiRecordSource {
  if (!sourceUrl) return { section: "", id: "" };
  try {
    const parsed = new URL(sourceUrl, "https://www.swfi.com");
    if (!isAllowedSwfiHost(parsed.hostname)) return { section: "", id: "" };
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1Index = parts.indexOf("v1");
    const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
    const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
    if (!["entities", "people", "transactions", "compass"].includes(section || "")) return { section: "", id: "" };
    if (!/^[a-f0-9]{24}$/i.test(id || "")) return { section: "", id: "" };
    return { section: section as SwfiRecordSource["section"], id };
  } catch {
    return { section: "", id: "" };
  }
}

export function getDashboardDetailUrl(type: DashboardDetailType, row: Row = {}, options: DashboardDetailOptions = {}): string {
  if (type === "compare") {
    const left = text(options.left || row.left || row.left_id, "");
    const right = text(options.right || row.right || row.right_id, "");
    const params = new URLSearchParams();
    const ids = [left, right].filter((value) => /^[a-f0-9]{24}$/i.test(value));
    if (ids.length === 2 && ids[0].toLowerCase() !== ids[1].toLowerCase()) params.set("ids", ids.join(","));
    return `/comparisons/${params.toString() ? `?${params.toString()}` : ""}`;
  }

  if (isProfileType(type)) return profileDetailUrl(row, options);
  if (type === "transaction" || type === "deal") return transactionDetailUrl(row, options);
  if (type === "rfp" || type === "mandate" || type === "fundraising") return mandateDetailUrl(row, options);
  if (type === "person") return personDetailUrl(row, options);
  return researchDetailUrl(row, options);
}

export function profileDetailHref(row: Row, sourceUrl?: string): string {
  return getDashboardDetailUrl("profile", row, { sourceUrl });
}

export function transactionDetailHref(row: Row, sourceUrl?: string): string {
  return getDashboardDetailUrl("transaction", row, { sourceUrl });
}

export function mandateDetailHref(row: Row, sourceUrl?: string): string {
  return getDashboardDetailUrl("mandate", row, { sourceUrl });
}

export function personDetailHref(row: Row, sourceUrl?: string): string {
  return getDashboardDetailUrl("person", row, { sourceUrl });
}

export function researchDetailHref(row: Row, sourceUrl?: string): string {
  return getDashboardDetailUrl("research", row, { sourceUrl });
}

function isProfileType(type: DashboardDetailType): boolean {
  return type === "entity" || type === "institution" || type === "investor" || type === "allocator" || type === "profile";
}

function profileDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const handoff = swfiRecordHandoffUrl("entities", row, options, ["entity_id", "entityID", "id", "source_record_id"]);
  if (handoff) return handoff;
  const label = text(row.name || row.institution, "");
  return discoveryFallback(options.label || label);
}

function transactionDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const handoff = swfiRecordHandoffUrl("transactions", row, options, ["transaction_id", "transactionID", "id", "source_record_id"]);
  if (handoff) return handoff;
  const label = text(options.label || row.title || row.name || row.institution, "");
  return discoveryFallback(label);
}

function mandateDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const handoff = swfiRecordHandoffUrl("compass", row, options, ["compass_id", "mandate_id", "rfp_id", "id", "source_record_id"]);
  if (handoff) return handoff;
  const label = text(options.label || row.title || row.name || row.institution, "");
  return discoveryFallback(label);
}

function personDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const handoff = swfiRecordHandoffUrl("people", row, options, ["person_id", "personID", "id", "source_record_id"]);
  if (handoff) return handoff;
  const label = text(options.label || row.name || row.title, "");
  return discoveryFallback(label);
}

export function legacyPostId(sourceUrl: string | undefined): string {
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    return isAllowedSwfiHost(parsed.hostname) ? parsed.searchParams.get("p") || "" : "";
  } catch {
    const match = String(sourceUrl || "").match(/[?&]p=(\d+)/);
    return match?.[1] || "";
  }
}

function isAllowedSwfiUrl(value: string): boolean {
  try {
    return isAllowedSwfiHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function researchDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const label = text(options.label || row.title || row.name, "");
  const source = text(options.sourceUrl || row.source_url || row.swfi_url || row.url, "");
  if (/^https?:\/\//i.test(source) && isAllowedSwfiUrl(source)) {
    const sourceRecord = parseSwfiRecordSource(source);
    const handoff = swfiAuthHandoffHref(source);
    return sourceRecord.id || handoff !== source ? handoff : source;
  }
  const legacy = legacyPostId(options.sourceUrl) || text(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id, "");
  if (legacy) return `https://www.swfi.com/?p=${encodeURIComponent(legacy)}`;
  return discoveryFallback(label);
}

function discoveryFallback(label: string): string {
  const params = new URLSearchParams();
  if (label) params.set("q", label);
  return `/search/${params.toString() ? `?${params.toString()}` : ""}`;
}

function swfiRecordHandoffUrl(section: SwfiSection, row: Row, options: DashboardDetailOptions, idKeys: string[]): string {
  const id = rowRecordId(section, row, options, idKeys);
  if (!id) return "";
  return swfiAuthHandoffHref(`https://www.swfi.com/v1/${section}/${id}`);
}

function rowRecordId(section: SwfiSection, row: Row, options: DashboardDetailOptions, idKeys: string[]): string {
  const source = text(options.sourceUrl || row.source_url || row.swfi_url || row.url, "");
  const sourceRecord = parseSwfiRecordSource(source);
  if (sourceRecord.section === section && validRecordId(sourceRecord.id)) return sourceRecord.id;

  const sourceContradicts = Boolean(sourceRecord.section && sourceRecord.section !== section);
  const keys = sourceContradicts
    ? idKeys.filter((key) => key !== "id" && key !== "_id" && key !== "source_record_id")
    : idKeys;
  return keys.map((key) => text(row[key], "")).find(validRecordId) || "";
}

function validRecordId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value || "");
}
