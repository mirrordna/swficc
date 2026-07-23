export const SEARCH_SORT_KEYS = ["relevance", "type", "result", "source", "detail"] as const;
export const SEARCH_SORT_DIRECTIONS = ["asc", "desc"] as const;
export const SEARCH_ROW_LIMITS = [5, 10, 25, 50, 100] as const;
export const SEARCH_ALL_CATEGORY_LIMITS = [5, 10] as const;
export const SEARCH_FILTER_KEYS = [
  "geography",
  "recordType",
  "transactionType",
  "buyer",
  "seller",
  "sector",
  "strategy",
  "source",
  "institution",
  "role",
] as const;

export type SearchSortKey = (typeof SEARCH_SORT_KEYS)[number];
export type SearchSortDirection = (typeof SEARCH_SORT_DIRECTIONS)[number];
export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number];
export type SearchFilters = Record<SearchFilterKey, string>;

export type SearchUrlContext = {
  sortKey: SearchSortKey;
  sortDir: SearchSortDirection;
  rowLimit: number;
  allCategoryLimit: number;
  filters: SearchFilters;
};

export type SearchUrlContextPatch = Partial<Omit<SearchUrlContext, "filters">> & {
  filters?: Partial<SearchFilters>;
  clearFilters?: boolean;
};

const FILTER_PARAMETER_BY_KEY: Record<SearchFilterKey, string> = {
  geography: "filter_geography",
  recordType: "filter_record_type",
  transactionType: "filter_transaction_type",
  buyer: "filter_buyer",
  seller: "filter_seller",
  sector: "filter_sector",
  strategy: "filter_strategy",
  source: "filter_source",
  institution: "filter_institution",
  role: "filter_role",
};

export function emptySearchFilters(): SearchFilters {
  return Object.fromEntries(SEARCH_FILTER_KEYS.map((key) => [key, ""])) as SearchFilters;
}

export function searchUrlContextFromParams(searchParams: Pick<URLSearchParams, "get">): SearchUrlContext {
  const sortKey = allowedString(searchParams.get("sort"), SEARCH_SORT_KEYS, "relevance");
  const sortDir = allowedString(searchParams.get("dir"), SEARCH_SORT_DIRECTIONS, "asc");
  const rowLimit = allowedNumber(searchParams.get("rows"), SEARCH_ROW_LIMITS, 10);
  const allCategoryLimit = allowedNumber(searchParams.get("per_category"), SEARCH_ALL_CATEGORY_LIMITS, 5);
  const filters = emptySearchFilters();
  for (const key of SEARCH_FILTER_KEYS) filters[key] = (searchParams.get(FILTER_PARAMETER_BY_KEY[key]) || "").trim();
  return { sortKey, sortDir, rowLimit, allCategoryLimit, filters };
}

export function patchSearchUrlContext(
  currentParams: URLSearchParams,
  patch: SearchUrlContextPatch,
): URLSearchParams {
  const params = new URLSearchParams(currentParams);

  if (patch.sortKey !== undefined) setOrDelete(params, "sort", patch.sortKey, "relevance");
  if (patch.sortDir !== undefined) setOrDelete(params, "dir", patch.sortDir, "asc");
  if (patch.rowLimit !== undefined) setOrDelete(params, "rows", String(normalizedNumber(patch.rowLimit, SEARCH_ROW_LIMITS, 10)), "10");
  if (patch.allCategoryLimit !== undefined) setOrDelete(params, "per_category", String(normalizedNumber(patch.allCategoryLimit, SEARCH_ALL_CATEGORY_LIMITS, 5)), "5");

  if (patch.clearFilters) {
    for (const key of SEARCH_FILTER_KEYS) params.delete(FILTER_PARAMETER_BY_KEY[key]);
  }
  if (patch.filters) {
    for (const key of SEARCH_FILTER_KEYS) {
      if (!(key in patch.filters)) continue;
      setOrDelete(params, FILTER_PARAMETER_BY_KEY[key], String(patch.filters[key] || "").trim());
    }
  }
  return params;
}

function allowedString<const Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  return allowed.includes(value as Value) ? value as Value : fallback;
}

function allowedNumber(
  value: string | null,
  allowed: readonly number[],
  fallback: number,
): number {
  return normalizedNumber(Number(value), allowed, fallback);
}

function normalizedNumber(value: number, allowed: readonly number[], fallback: number): number {
  return allowed.includes(value) ? value : fallback;
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue = ""): void {
  if (!value || value === defaultValue) params.delete(key);
  else params.set(key, value);
}
