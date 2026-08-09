type Packet = Record<string, unknown>;
type Row = Record<string, unknown>;

export const ALLOCATOR_WINDOWS = [30, 60, 90, 365] as const;
export const ALLOCATOR_SORTS = ["activity_count", "total_deal_value", "most_recent_activity_date", "name", "country", "entity_type"] as const;
export type AllocatorWindow = (typeof ALLOCATOR_WINDOWS)[number];
export type AllocatorSort = (typeof ALLOCATOR_SORTS)[number];
export type AllocatorDirection = "asc" | "desc";
export type AllocatorState = "pending" | "ready" | "empty" | "unavailable" | "invalid";

export type AllocatorRequest = {
  days: AllocatorWindow;
  limit: number;
  page: number;
  sort: AllocatorSort;
  direction: AllocatorDirection;
  query: string;
  country: string;
  region: string;
  entityType: string;
  aumMin: string;
  aumMax: string;
};

export type AllocatorRequestInput = {
  days?: number;
  limit?: number;
  page?: number;
  sort?: string;
  direction?: string;
  query?: string;
  country?: string;
  region?: string;
  entityType?: string;
  aumMin?: string | number;
  aumMax?: string | number;
};

export type AllocatorFilters = Pick<AllocatorRequest, "country" | "region" | "entityType" | "aumMin" | "aumMax">;

export type AllocatorFilterValidation =
  | { ok: true; filters: AllocatorFilters; issue: "" }
  | { ok: false; filters: AllocatorFilters; issue: string };

export function emptyAllocatorFilters(): AllocatorFilters {
  return { country: "", region: "", entityType: "", aumMin: "", aumMax: "" };
}

export function normalizeAllocatorFilters(value: Partial<AllocatorFilters> = {}): AllocatorFilterValidation {
  const bounds = [normalizeWholeNumber(value.aumMin), normalizeWholeNumber(value.aumMax)] as const;
  const filters: AllocatorFilters = {
    country: String(value.country || "").trim(),
    region: String(value.region || "").trim(),
    entityType: String(value.entityType || "").trim(),
    aumMin: bounds[0].value,
    aumMax: bounds[1].value,
  };
  if (!bounds[0].valid || !bounds[1].valid) {
    return { ok: false, filters, issue: "AUM bounds must be non-negative whole USD amounts." };
  }
  if (filters.aumMin && filters.aumMax && Number(filters.aumMin) > Number(filters.aumMax)) {
    return { ok: false, filters, issue: "Minimum AUM cannot exceed maximum AUM." };
  }
  return { ok: true, filters, issue: "" };
}

export type AllocatorContract = {
  state: AllocatorState;
  rows: Row[];
  issues: string[];
  count: number;
};

export type AllocatorCountContract = Omit<AllocatorContract, "rows">;

export function normalizeAllocatorRequest(value: AllocatorRequestInput = {}): AllocatorRequest {
  const days = ALLOCATOR_WINDOWS.includes(Number(value.days) as AllocatorWindow) ? Number(value.days) as AllocatorWindow : 90;
  const limit = Math.min(100, Math.max(1, Math.trunc(finite(value.limit) ?? 10)));
  const page = Math.min(500, Math.max(1, Math.trunc(finite(value.page) ?? 1)));
  const sort = ALLOCATOR_SORTS.includes(String(value.sort) as AllocatorSort) ? String(value.sort) as AllocatorSort : "activity_count";
  const direction = value.direction === "asc" ? "asc" : "desc";
  const query = String(value.query || "").trim();
  const filterValidation = normalizeAllocatorFilters({
    country: value.country,
    region: value.region,
    entityType: value.entityType,
    aumMin: String(value.aumMin ?? ""),
    aumMax: String(value.aumMax ?? ""),
  });
  const filters = filterValidation.ok ? filterValidation.filters : emptyAllocatorFilters();
  return { days, limit, page, sort, direction, query: query.length >= 3 ? query : "", ...filters };
}

export function allocatorSourceEndpoint(value: AllocatorRequestInput = {}): string {
  const request = normalizeAllocatorRequest(value);
  const params = new URLSearchParams({
    days: String(request.days),
    limit: String(request.limit),
    page: String(request.page),
    sort: request.sort,
    direction: request.direction,
  });
  if (request.query) params.set("q", request.query);
  if (request.country) params.set("country", request.country);
  if (request.region) params.set("region", request.region);
  if (request.entityType) params.set("entity_type", request.entityType);
  if (request.aumMin) params.set("aum_min", request.aumMin);
  if (request.aumMax) params.set("aum_max", request.aumMax);
  return `/api/allocator-activity/v1?${params.toString()}`;
}

export function allocatorCountEndpoint(days: number = 90): string {
  const request = normalizeAllocatorRequest({ days, limit: 1, page: 1, sort: "activity_count", direction: "desc" });
  return `/api/allocator-activity/v1?days=${request.days}&limit=1&page=1&count_only=1&sort=activity_count&direction=desc`;
}

export function inspectAllocatorCountPacket(packet: Packet | undefined, days: number = 90): AllocatorCountContract {
  if (packet === undefined) return { state: "pending", issues: [], count: 0 };
  if (String(packet.status || "").toLowerCase() !== "ok" || packet.fact !== true) {
    const reason = String(packet.unavailable_reason || "").trim();
    return { state: "unavailable", issues: [reason || "source_unavailable"], count: 0 };
  }
  const request = normalizeAllocatorRequest({ days });
  const data = record(packet.data);
  const count = integer(data.count);
  const packetRows = Array.isArray(data.rows) ? data.rows : [];
  const issues: string[] = [];
  if (integer(data.window_days) !== request.days) issues.push("window_days_mismatch");
  if (data.activity_mode !== "completed_transactions") issues.push("activity_mode_unapproved");
  if (integer(data.requested_limit) !== 0) issues.push("count_only_limit_mismatch");
  if (integer(data.page) !== 1) issues.push("page_mismatch");
  if (data.sort !== "activity_count" || data.direction !== "desc") issues.push("sort_mismatch");
  if (data.entity_status_scope !== "active_only" || data.include_defunct !== false) issues.push("lifecycle_scope_not_active_only");
  if (data.count_basis !== "resolved_active_buyer_or_acquirer_entities") issues.push("count_basis_unapproved");
  const responseFilters = record(data.filters);
  if (String(responseFilters.country || "") !== request.country) issues.push("country_filter_mismatch");
  if (String(responseFilters.region || "") !== request.region) issues.push("region_filter_mismatch");
  if (String(responseFilters.entity_type || "") !== request.entityType) issues.push("entity_type_filter_mismatch");
  if (optionalIntegerText(responseFilters.aum_min) !== request.aumMin) issues.push("aum_min_filter_mismatch");
  if (optionalIntegerText(responseFilters.aum_max) !== request.aumMax) issues.push("aum_max_filter_mismatch");
  if (responseFilters.currency_conversion !== false) issues.push("allocator_currency_conversion_must_be_false");
  if ((request.aumMin || request.aumMax) && responseFilters.aum_currency !== "USD") issues.push("allocator_aum_filter_currency_must_be_usd");
  if (integer(data.defunct_entities_excluded) === null) issues.push("defunct_exclusion_count_missing");
  if (integer(data.unresolved_entity_lifecycle_excluded) === null) issues.push("unresolved_lifecycle_count_missing");
  if (count === null) issues.push("count_missing");
  if (packetRows.length !== 0) issues.push("count_only_rows_present");
  if (data.has_more !== false || data.next_page != null) issues.push("count_only_pagination_mismatch");
  if (timestamp(packet.generated_at) === null) issues.push("generated_at_missing_or_invalid");
  return { state: issues.length ? "invalid" : count === 0 ? "empty" : "ready", issues, count: count ?? 0 };
}

export function inspectAllocatorPacket(packet: Packet | undefined, value: AllocatorRequestInput = {}): AllocatorContract {
  if (packet === undefined) return empty("pending");
  if (String(packet.status || "").toLowerCase() !== "ok" || packet.fact !== true) {
    const reason = String(packet.unavailable_reason || "").trim();
    return { ...empty("unavailable"), issues: [reason || "source_unavailable"] };
  }

  const request = normalizeAllocatorRequest(value);
  const data = record(packet.data);
  const rows = Array.isArray(data.rows) ? data.rows.filter(isRow) : [];
  const count = integer(data.count);
  const issues: string[] = [];

  if (integer(data.window_days) !== request.days) issues.push("window_days_mismatch");
  if (integer(data.requested_limit) !== request.limit) issues.push("requested_limit_mismatch");
  if (integer(data.page) !== request.page) issues.push("page_mismatch");
  if (data.sort !== request.sort) issues.push("sort_mismatch");
  if (data.direction !== request.direction) issues.push("direction_mismatch");
  if (data.activity_mode !== "completed_transactions") issues.push("activity_mode_unapproved");
  if (data.entity_status_scope !== "active_only" || data.include_defunct !== false) issues.push("lifecycle_scope_not_active_only");
  if (data.count_basis !== "resolved_active_buyer_or_acquirer_entities") issues.push("count_basis_unapproved");
  const responseFilters = record(data.filters);
  if (String(responseFilters.country || "") !== request.country) issues.push("country_filter_mismatch");
  if (String(responseFilters.region || "") !== request.region) issues.push("region_filter_mismatch");
  if (String(responseFilters.entity_type || "") !== request.entityType) issues.push("entity_type_filter_mismatch");
  if (optionalIntegerText(responseFilters.aum_min) !== request.aumMin) issues.push("aum_min_filter_mismatch");
  if (optionalIntegerText(responseFilters.aum_max) !== request.aumMax) issues.push("aum_max_filter_mismatch");
  if (responseFilters.currency_conversion !== false) issues.push("allocator_currency_conversion_must_be_false");
  if ((request.aumMin || request.aumMax) && responseFilters.aum_currency !== "USD") issues.push("allocator_aum_filter_currency_must_be_usd");
  if (integer(data.defunct_entities_excluded) === null) issues.push("defunct_exclusion_count_missing");
  if (integer(data.unresolved_entity_lifecycle_excluded) === null) issues.push("unresolved_lifecycle_count_missing");
  if (count === null) issues.push("count_missing");
  if (rows.length > request.limit) issues.push("returned_more_than_requested");
  if (count !== null && rows.length > count) issues.push("rows_exceed_count");
  if (count !== null && request.page > 1 && rows.length === 0 && (request.page - 1) * request.limit < count) issues.push("empty_page_inside_count_range");
  if (typeof data.has_more !== "boolean") issues.push("has_more_missing");
  if (count !== null && typeof data.has_more === "boolean" && data.has_more !== (request.page * request.limit < count)) issues.push("has_more_mismatch");
  if (data.has_more === true && integer(data.next_page) !== request.page + 1) issues.push("next_page_mismatch");
  if (data.has_more === false && data.next_page != null) issues.push("terminal_next_page_present");

  const generatedAt = timestamp(packet.generated_at);
  if (generatedAt === null) issues.push("generated_at_missing_or_invalid");
  const cutoff = generatedAt === null ? null : generatedAt - request.days * 86_400_000;
  const seenSources = new Set<string>();
  rows.forEach((row, index) => {
    const ordinal = index + 1;
    const name = String(row.name || "").trim();
    if (!name) issues.push(`name_${ordinal}`);
    if (!String(row.entity_type || row.type || "").trim()) issues.push(`entity_type_${ordinal}`);
    if (!String(row.country || "").trim()) issues.push(`country_${ordinal}`);
    if (!String(row.region || "").trim()) issues.push(`region_${ordinal}`);
    if (row.activity_reason !== `Completed buyer/acquirer transactions in the last ${request.days} days`) issues.push(`activity_reason_${ordinal}`);
    const activityCount = positiveInteger(row.activity_count);
    const dealCount = positiveInteger(row.deal_count);
    if (activityCount === null || dealCount === null || activityCount !== dealCount) issues.push(`activity_count_${ordinal}`);
    const totalDealValue = finite(row.total_deal_value);
    if (totalDealValue === null || totalDealValue < 0) issues.push(`total_deal_value_${ordinal}`);
    if (totalDealValue !== null && totalDealValue > 0 && !/^\$[0-9,]+(?:\.\d+)?$/.test(String(row.total_deal_value_display || ""))) issues.push(`total_deal_value_display_${ordinal}`);
    if (totalDealValue === 0 && String(row.total_deal_value_display || "") !== "Not disclosed") issues.push(`zero_value_must_remain_undisclosed_${ordinal}`);

    const activityDate = timestamp(row.most_recent_activity_date || row.latest_transaction_date || row.last_transaction_date);
    if (activityDate === null) issues.push(`activity_date_${ordinal}`);
    else if (generatedAt !== null && (activityDate > generatedAt + 86_400_000 || (cutoff !== null && activityDate < cutoff - 86_400_000))) issues.push(`activity_date_outside_window_${ordinal}`);

    const source = canonicalSource(row.source_url, "entities");
    if (!source) issues.push(`source_url_${ordinal}`);
    else if (seenSources.has(source)) issues.push(`duplicate_source_${ordinal}`);
    else seenSources.add(source);
    const latestTransaction = canonicalSource(row.latest_transaction_source_url, "transactions");
    if (!latestTransaction) issues.push(`latest_transaction_source_${ordinal}`);
    const dealSources = Array.isArray(row.deal_source_urls) ? row.deal_source_urls.map((item) => canonicalSource(item, "transactions")) : [];
    if (!dealSources.length || dealSources.some((item) => !item) || new Set(dealSources).size !== dealSources.length) issues.push(`deal_sources_${ordinal}`);
    if (latestTransaction && dealSources.length && dealSources[0] !== latestTransaction) issues.push(`latest_transaction_not_first_source_${ordinal}`);
    if (row.activity_count !== row.deal_count) issues.push(`activity_count_alias_${ordinal}`);
    if (row.most_recent_activity_date !== row.latest_transaction_date || row.most_recent_activity_date !== row.last_transaction_date) issues.push(`activity_date_alias_${ordinal}`);
    if (row.source_url !== row.swfi_url) issues.push(`source_url_alias_${ordinal}`);
  });

  for (let index = 0; index < rows.length - 1; index += 1) {
    if (allocatorSortComparison(rows[index], rows[index + 1], request.sort, request.direction) > 0) issues.push(`sort_order_${index + 1}`);
  }

  if (!rows.length) {
    if (count === 0 || (count !== null && (request.page - 1) * request.limit >= count)) return { state: issues.length ? "invalid" : "empty", rows: [], issues, count: count ?? 0 };
    issues.push("empty_rows_with_nonzero_or_unknown_count");
  }

  return { state: issues.length ? "invalid" : "ready", rows: issues.length ? [] : rows, issues, count: count ?? 0 };
}

function allocatorSortComparison(left: Row, right: Row, sort: AllocatorSort, direction: AllocatorDirection): number {
  let comparison = 0;
  if (sort === "activity_count") {
    comparison = (finite(right.activity_count ?? right.deal_count) ?? 0) - (finite(left.activity_count ?? left.deal_count) ?? 0);
    if (direction === "asc") comparison = -comparison;
    if (comparison === 0) comparison = (finite(right.total_deal_value) ?? 0) - (finite(left.total_deal_value) ?? 0);
    if (comparison === 0) comparison = (timestamp(right.most_recent_activity_date || right.latest_transaction_date) ?? 0) - (timestamp(left.most_recent_activity_date || left.latest_transaction_date) ?? 0);
    if (comparison === 0) comparison = sourceTextComparison(String(left.name || ""), String(right.name || ""));
    return comparison;
  }
  else if (sort === "total_deal_value") comparison = (finite(right.total_deal_value) ?? 0) - (finite(left.total_deal_value) ?? 0);
  else if (sort === "most_recent_activity_date") comparison = (timestamp(right.most_recent_activity_date || right.latest_transaction_date) ?? 0) - (timestamp(left.most_recent_activity_date || left.latest_transaction_date) ?? 0);
  else {
    const key = sort === "name" ? "name" : sort === "country" ? "country" : "entity_type";
    comparison = sourceTextComparison(String(right[key] || right.type || ""), String(left[key] || left.type || ""));
  }
  return direction === "asc" ? -comparison : comparison;
}

function sourceTextComparison(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase("en-US");
  const normalizedRight = right.toLocaleLowerCase("en-US");
  if (normalizedLeft === normalizedRight) return left === right ? 0 : left < right ? -1 : 1;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function empty(state: AllocatorState): AllocatorContract {
  return { state, rows: [], issues: [], count: 0 };
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number >= 0 && Number.isInteger(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = integer(value);
  return number !== null && number > 0 ? number : null;
}

function timestamp(value: unknown): number | null {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function optionalIntegerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finite(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0 ? String(number) : "invalid";
}

function normalizeWholeNumber(value: unknown): { value: string; valid: boolean } {
  const clean = String(value ?? "").trim();
  if (!clean) return { value: "", valid: true };
  if (!/^\d+$/.test(clean)) return { value: clean, valid: false };
  const number = Number(clean);
  return Number.isSafeInteger(number) && number >= 0
    ? { value: String(number), valid: true }
    : { value: clean, valid: false };
}

function canonicalSource(value: unknown, collection: "entities" | "transactions"): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.swfi.com" || parsed.search || parsed.hash) return "";
    if (!new RegExp(`^/v1/${collection}/[a-f0-9]{24}/?$`, "i").test(parsed.pathname)) return "";
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return "";
  }
}
