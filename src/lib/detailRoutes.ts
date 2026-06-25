import { text } from "@/lib/sourcePackets";

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
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || "");
  } catch {
    return "";
  }
}

export function getDashboardDetailUrl(type: DashboardDetailType, row: Row = {}, options: DashboardDetailOptions = {}): string {
  if (type === "compare") {
    const left = text(options.left || row.left || row.left_id, "");
    const right = text(options.right || row.right || row.right_id, "");
    const params = new URLSearchParams();
    if (left) params.set("left", left);
    if (right) params.set("right", right);
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
  const label = text(row.name || row.institution, "");
  const slug = text(options.slug || row.slug || row.profile_slug, "");
  const id = text(row.id || row.entity_id || row.source_record_id, "") || sourceRecordId(options.sourceUrl);
  const params = new URLSearchParams();
  if (slug) params.set("slug", slug);
  if (options.label || label) params.set("name", options.label || label);
  if (!slug && !(options.label || label) && id) params.set("id", id);
  return `/profiles/detail/?${params.toString()}`;
}

function transactionDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const label = text(options.label || row.title || row.name || row.institution, "");
  const id = text(row.id || row.transaction_id || row.source_record_id, "") || sourceRecordId(options.sourceUrl);
  const params = new URLSearchParams();
  if (label) params.set("title", label);
  if (!label && id) params.set("id", id);
  return `/transactions/detail/?${params.toString()}`;
}

function mandateDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const label = text(options.label || row.title || row.name || row.institution, "");
  const id = text(row.id || row.compass_id || row.source_record_id, "") || sourceRecordId(options.sourceUrl);
  const params = new URLSearchParams();
  if (label) params.set("title", label);
  if (!label && id) params.set("id", id);
  return `/mandates/detail/?${params.toString()}`;
}

function personDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const label = text(options.label || row.name || row.title, "");
  const id = text(row.id || row.person_id || row.source_record_id, "") || sourceRecordId(options.sourceUrl);
  const params = new URLSearchParams();
  if (label) params.set("name", label);
  if (!label && id) params.set("id", id);
  return `/people/detail/?${params.toString()}`;
}

export function legacyPostId(sourceUrl: string | undefined): string {
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    return parsed.searchParams.get("p") || "";
  } catch {
    const match = String(sourceUrl || "").match(/[?&]p=(\d+)/);
    return match?.[1] || "";
  }
}

function researchDetailUrl(row: Row, options: DashboardDetailOptions): string {
  const label = text(options.label || row.title || row.name, "");
  const legacy = legacyPostId(options.sourceUrl) || text(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id, "");
  const params = new URLSearchParams();
  if (label) params.set("title", label);
  if (legacy) params.set("legacy", legacy);
  return `/research/detail/?${params.toString()}`;
}
