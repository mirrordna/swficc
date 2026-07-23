import { comparisonEntityId, comparisonPeerTypeKey, comparisonSourceUrl } from "@/lib/competitionAnalysis";
import { isFact, packetData, packetReason, rows, type Packet, type Row } from "@/lib/sourcePackets";

export const COMPARISON_SEARCH_LIMIT = 12;
export const COMPARISON_TRANSACTION_SAMPLE_LIMIT = 25;

export type ComparisonEntityListRequest = {
  query?: string;
  entityType?: string;
  region?: string;
  includeDefunct?: boolean;
  limit?: number;
  page?: number;
};

export type ComparisonPacketState = "ready" | "empty" | "invalid" | "unavailable";

export type ComparisonPacketInspection = {
  state: ComparisonPacketState;
  issues: string[];
  reason: string;
};

export type ComparisonEntityListInspection = ComparisonPacketInspection & {
  rows: Row[];
  count: number | null;
  excludedByExactTypeGuard: number;
  exactTypeCountAvailable: boolean;
  page: number | null;
  requestedLimit: number | null;
  hasMore: boolean | null;
};

export type ComparisonProfileInspection = ComparisonPacketInspection & {
  profile: Row | null;
};

export type ComparisonTransactionInspection = ComparisonPacketInspection & {
  rows: Row[];
  totalTransactions: number | null;
  buyersOnly: boolean | null;
  requestedLimit: number | null;
};

export function comparisonEntityListEndpoint(request: ComparisonEntityListRequest = {}): string {
  const params = new URLSearchParams({ collection: "entities" });
  const query = cleanText(request.query);
  const entityType = cleanText(request.entityType);
  const region = cleanText(request.region);
  if (query && query.toLowerCase() !== entityType.toLowerCase()) params.set("q", query);
  if (entityType) params.set("entity_type", entityType);
  if (region) params.set("region", region);
  if (request.includeDefunct) params.set("include_defunct", "true");
  params.set("limit", String(normalizeLimit(request.limit, 25)));
  params.set("page", String(normalizePage(request.page)));
  return `/api/source-data/search/v1?${params.toString()}`;
}

export function comparisonPeerSearchEndpoint(query: string): string {
  return comparisonEntityListEndpoint({ query, limit: COMPARISON_SEARCH_LIMIT, page: 1 });
}

export function comparisonProfileEndpoint(entityId: string): string {
  return `/api/profiles/${encodeURIComponent(validEntityId(entityId))}/v1`;
}

export function comparisonTransactionTotalEndpoint(entityId: string): string {
  return `/api/entity-transactions/v1?entity_id=${encodeURIComponent(validEntityId(entityId))}&limit=1`;
}

export function comparisonBuyerActivityEndpoint(entityId: string): string {
  return `/api/entity-transactions/v1?entity_id=${encodeURIComponent(validEntityId(entityId))}&buyers_only=1&limit=${COMPARISON_TRANSACTION_SAMPLE_LIMIT}`;
}

export function inspectComparisonEntityListPacket(
  packet: Packet | undefined,
  request: ComparisonEntityListRequest = {},
): ComparisonEntityListInspection {
  const base = inspectEnvelope(packet);
  const payload = packetData(packet);
  const packetRows = rows(packet);
  const requestedTypeKey = normalizedTypeKey(request.entityType);
  const count = finiteNonNegative(payload.count);
  const page = finitePositiveInteger(payload.page);
  const requestedLimit = finitePositiveInteger(payload.requested_limit);
  const hasMore = typeof payload.has_more === "boolean" ? payload.has_more : null;
  const issues = [...base.issues];

  if (base.state === "ready" || base.state === "empty") {
    if (payload.collection !== "entities") issues.push("collection_not_entities");
    if (!Array.isArray(payload.rows)) issues.push("rows_not_array");
    if (count == null) issues.push("count_missing_or_invalid");
    if (count != null && count < packetRows.length) issues.push("count_less_than_loaded_rows");
    const expectedPage = normalizePage(request.page);
    const expectedLimit = normalizeLimit(request.limit, 25);
    if (page !== expectedPage) issues.push("page_mismatch");
    if (requestedLimit !== expectedLimit) issues.push("requested_limit_mismatch");

    const filters = record(payload.filters);
    if (cleanText(filters.query) !== cleanText(request.query)) issues.push("query_filter_mismatch");
    if (cleanText(filters.entity_type) !== cleanText(request.entityType)) issues.push("entity_type_filter_mismatch");
    if (cleanText(filters.region) !== cleanText(request.region)) issues.push("region_filter_mismatch");
    if (Boolean(filters.include_defunct) !== Boolean(request.includeDefunct)) issues.push("include_defunct_filter_mismatch");

    const keys = new Set<string>();
    packetRows.forEach((row, index) => {
      const id = comparisonEntityId(row);
      const source = comparisonSourceUrl(row);
      if (!id) issues.push(`row_${index}_missing_entity_id`);
      if (!source || !new RegExp(`/v1/entities/${id}$`, "i").test(source)) issues.push(`row_${index}_invalid_source_url`);
      if (!cleanText(row.name)) issues.push(`row_${index}_missing_name`);
      if (!request.includeDefunct && (row.defunct === true || cleanText(row.entity_status).toLowerCase() === "defunct")) {
        issues.push(`row_${index}_defunct_in_active_scope`);
      }
      if (id && keys.has(id)) issues.push(`row_${index}_duplicate_entity_id`);
      if (id) keys.add(id);
    });
  }

  const state = issues.length
    ? "invalid"
    : base.state === "ready" && packetRows.length === 0 && count === 0
      ? "empty"
      : base.state;
  const exactRows = requestedTypeKey
    ? packetRows.filter((row) => comparisonPeerTypeKey(row) === requestedTypeKey)
    : packetRows;
  return {
    state,
    issues,
    reason: issues[0] || base.reason,
    rows: state === "invalid" ? [] : exactRows,
    count,
    excludedByExactTypeGuard: requestedTypeKey ? packetRows.length - exactRows.length : 0,
    // The live endpoint currently applies entity_type as a broad text match.
    // Until the backend exposes exact semantics, its count cannot be presented
    // as the exact peer-type universe.
    exactTypeCountAvailable: !requestedTypeKey,
    page,
    requestedLimit,
    hasMore,
  };
}

export function inspectComparisonProfilePacket(packet: Packet | undefined, expectedEntityId: string): ComparisonProfileInspection {
  const base = inspectEnvelope(packet);
  const rawProfile = packetData(packet).profile;
  const profile = rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile) ? rawProfile as Row : null;
  const issues = [...base.issues];
  if (base.state === "ready" || base.state === "empty") {
    if (!profile) issues.push("profile_missing_or_invalid");
    if (profile && comparisonEntityId(profile) !== validEntityId(expectedEntityId)) issues.push("profile_entity_id_mismatch");
    if (profile && !cleanText(profile.name)) issues.push("profile_name_missing");
    if (profile && !comparisonPeerTypeKey(profile)) issues.push("profile_entity_type_missing");
    if (profile && !comparisonSourceUrl(profile)) issues.push("profile_source_url_missing");
    if (profile && (!profile.modules || typeof profile.modules !== "object" || Array.isArray(profile.modules))) issues.push("profile_modules_missing");
  }
  const state = issues.length ? "invalid" : base.state === "empty" ? "invalid" : base.state;
  return { state, issues, reason: issues[0] || base.reason, profile: state === "ready" ? profile : null };
}

export function inspectComparisonTransactionPacket(
  packet: Packet | undefined,
  options: { entityId: string; buyersOnly: boolean; requestedLimit: number },
): ComparisonTransactionInspection {
  const base = inspectEnvelope(packet);
  const payload = packetData(packet);
  const packetRows = rows(packet);
  const count = finiteNonNegative(payload.count);
  const totalTransactions = finiteNonNegative(payload.total_transactions);
  const buyersOnly = typeof payload.buyers_only === "boolean" ? payload.buyers_only : false;
  const requestedLimit = finitePositiveInteger(payload.requested_limit);
  const issues = [...base.issues];
  if (base.state === "ready" || base.state === "empty") {
    if (!Array.isArray(payload.rows)) issues.push("transaction_rows_not_array");
    if (count == null || totalTransactions == null) issues.push("transaction_total_missing_or_invalid");
    if (count != null && totalTransactions != null && count !== totalTransactions) issues.push("transaction_count_total_mismatch");
    if (buyersOnly !== options.buyersOnly) issues.push("buyers_only_mismatch");
    if (requestedLimit !== options.requestedLimit) issues.push("transaction_requested_limit_mismatch");
    if (packetRows.length > options.requestedLimit) issues.push("transaction_rows_exceed_limit");
    const entity = record(payload.entity);
    if (comparisonEntityId(entity) !== validEntityId(options.entityId)) issues.push("transaction_entity_id_mismatch");
    packetRows.forEach((row, index) => {
      if (options.buyersOnly && cleanText(row.role).toLowerCase() !== "buyer") issues.push(`transaction_${index}_not_buyer_role`);
      const source = cleanText(row.source_url || row.swfi_url);
      if (!/^https:\/\/(?:www\.)?swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i.test(source)) {
        issues.push(`transaction_${index}_invalid_source_url`);
      }
    });
  }
  const state = issues.length
    ? "invalid"
    : base.state === "ready" && totalTransactions === 0 && packetRows.length === 0
      ? "empty"
      : base.state;
  return { state, issues, reason: issues[0] || base.reason, rows: state === "invalid" ? [] : packetRows, totalTransactions, buyersOnly, requestedLimit };
}

function inspectEnvelope(packet: Packet | undefined): ComparisonPacketInspection {
  if (!packet) return { state: "unavailable", issues: [], reason: "request_pending" };
  if (!isFact(packet)) return { state: "unavailable", issues: [], reason: packetReason(packet) || "source_unavailable" };
  const issues: string[] = [];
  if (!validTimestamp(packet.generated_at)) issues.push("generated_at_missing_or_invalid");
  if (!packet.data || typeof packet.data !== "object" || Array.isArray(packet.data)) issues.push("data_missing_or_invalid");
  return { state: issues.length ? "invalid" : "ready", issues, reason: issues[0] || "" };
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 50 ? Number(value) : fallback;
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function validEntityId(value: string): string {
  const clean = cleanText(value);
  return /^[a-f0-9]{24}$/i.test(clean) ? clean : "invalid-entity-id";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function cleanText(value: unknown): string {
  if (value == null || typeof value === "object") return "";
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedTypeKey(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
