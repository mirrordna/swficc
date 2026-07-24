import type { TextQueryEligibility } from "@/lib/textQueryPolicy";

export const SEARCH_REQUEST_LIFECYCLE_STATES = [
  "idle",
  "short_query",
  "debouncing",
  "loading",
  "partial_category_loading",
  "success_with_data",
  "success_empty",
  "unavailable",
  "error",
  "cancelled",
  "timed_out",
  "cached_stale",
] as const;

export type SearchRequestLifecycleState = (typeof SEARCH_REQUEST_LIFECYCLE_STATES)[number];

export type SearchSourceState =
  | "loading"
  | "success"
  | "unavailable"
  | "error"
  | "cancelled"
  | "timed_out";

export type SearchSourceSettlement = {
  state: SearchSourceState;
  itemCount: number;
  reason?: string;
};

type SearchSourceFailure = SearchSourceSettlement & {
  state: Exclude<SearchSourceState, "loading" | "success">;
};

export type SearchSourceSettlements<SourceKey extends string = string> = Partial<Record<SourceKey, SearchSourceSettlement>>;

export function beginSearchSourceSettlements<SourceKey extends string>(
  requiredSources: readonly SourceKey[],
): SearchSourceSettlements<SourceKey> {
  return Object.fromEntries(requiredSources.map((source) => [source, {
    state: "loading",
    itemCount: 0,
  }])) as SearchSourceSettlements<SourceKey>;
}

export function completedSearchSource(
  itemCount: number,
): SearchSourceSettlement {
  return {
    state: "success",
    itemCount: normalizedItemCount(itemCount),
  };
}

export function searchSourceSettlementFromPacket(
  packet: Record<string, unknown> | null | undefined,
  itemCount: number,
): SearchSourceSettlement {
  const status = String(packet?.status || "").trim().toLowerCase();
  const fact = packet?.fact === true;
  const reason = String(packet?.unavailable_reason || packet?.reason || "").trim();

  if (status === "ok" && fact) {
    const contractIssue = searchPacketContractIssue(packet);
    return contractIssue
      ? { state: "error", itemCount: 0, reason: contractIssue }
      : completedSearchSource(itemCount);
  }
  if (reason === "frontend_fetch_cancelled") return { state: "cancelled", itemCount: 0, reason };
  if (reason === "backend_fetch_aborted" || /timeout|timed_out/i.test(reason)) {
    return { state: "timed_out", itemCount: 0, reason: reason || "timed_out" };
  }
  if (status === "error" || /^backend_http_4\d\d$/.test(reason) || /invalid|validation|parse/i.test(reason)) {
    return { state: "error", itemCount: 0, reason: reason || status || "error" };
  }
  return { state: "unavailable", itemCount: 0, reason: reason || status || "unavailable" };
}

export function combineSearchSourceSettlements(
  settlements: readonly SearchSourceSettlement[],
): SearchSourceSettlement {
  if (!settlements.length) return completedSearchSource(0);
  const itemCount = settlements.reduce((total, settlement) => total + normalizedItemCount(settlement.itemCount), 0);
  const failure = firstFailureByPriority(settlements);
  return failure ? { ...failure, itemCount } : completedSearchSource(itemCount);
}

export function searchRequestLifecycleState<SourceKey extends string>({
  queryEligibility,
  requiredSources,
  settlements,
  resultCount,
  hasCachedResults = false,
}: {
  queryEligibility: TextQueryEligibility;
  requiredSources: readonly SourceKey[];
  settlements: SearchSourceSettlements<SourceKey>;
  resultCount: number;
  hasCachedResults?: boolean;
}): SearchRequestLifecycleState {
  if (queryEligibility === "idle") return "idle";
  if (queryEligibility === "short_query") return "short_query";
  if (!requiredSources.length) return "error";

  const sourceStates: SearchSourceSettlement[] = requiredSources.map((source) => settlements[source] || {
    state: "loading",
    itemCount: 0,
  });
  const loadingCount = sourceStates.filter((source) => source.state === "loading").length;
  const confirmedCount = normalizedItemCount(resultCount);

  if (loadingCount > 0) {
    if (hasCachedResults) return "cached_stale";
    if (confirmedCount > 0 || loadingCount < sourceStates.length) return "partial_category_loading";
    return "loading";
  }

  const failure = firstFailureByPriority(sourceStates);
  if (failure) return failure.state;
  return confirmedCount > 0 ? "success_with_data" : "success_empty";
}

export function isSearchRequestPending(state: SearchRequestLifecycleState): boolean {
  return state === "debouncing"
    || state === "loading"
    || state === "partial_category_loading"
    || state === "cached_stale";
}

export function isSearchRequestSettled(state: SearchRequestLifecycleState): boolean {
  return state === "success_with_data"
    || state === "success_empty"
    || state === "unavailable"
    || state === "error"
    || state === "cancelled"
    || state === "timed_out";
}

export function canRenderConfirmedEmpty(state: SearchRequestLifecycleState): boolean {
  return state === "success_empty";
}

function firstFailureByPriority(
  settlements: readonly SearchSourceSettlement[],
): SearchSourceFailure | undefined {
  for (const state of ["timed_out", "error", "unavailable", "cancelled"] as const) {
    const failure = settlements.find((settlement): settlement is SearchSourceFailure => settlement.state === state);
    if (failure) return failure;
  }
  return undefined;
}

function normalizedItemCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function searchPacketContractIssue(packet: Record<string, unknown>): string {
  const data = packet.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "malformed_fact_data";
  const payload = data as Record<string, unknown>;
  for (const key of ["rows", "results"] as const) {
    if (key in payload && !Array.isArray(payload[key])) return `malformed_fact_${key}`;
  }
  if ("count" in payload && (!Number.isFinite(Number(payload.count)) || Number(payload.count) < 0)) {
    return "malformed_fact_count";
  }
  return "";
}
