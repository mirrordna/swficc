export const SEARCH_RESULT_CATEGORY_ORDER = [
  "entities",
  "transactions",
  "opportunities",
  "news",
  "people",
] as const;

export type SearchResultCategory = (typeof SEARCH_RESULT_CATEGORY_ORDER)[number];

type SearchResultRow = Record<string, unknown> & { __searchCategory?: unknown };

export function balanceSearchResultRows<T extends SearchResultRow>(rows: readonly T[], perCategory: number): T[] {
  const limit = Math.max(1, Math.min(10, Math.floor(perCategory)));
  const buckets = new Map<SearchResultCategory, T[]>(
    SEARCH_RESULT_CATEGORY_ORDER.map((category) => [category, []]),
  );
  for (const row of rows) {
    const category = row.__searchCategory;
    if (!isSearchResultCategory(category)) continue;
    const bucket = buckets.get(category);
    if (bucket && bucket.length < limit) bucket.push(row);
  }

  const balanced: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    for (const category of SEARCH_RESULT_CATEGORY_ORDER) {
      const row = buckets.get(category)?.[index];
      if (row) balanced.push(row);
    }
  }
  return balanced;
}

export function searchResultRecordType(row: SearchResultRow): string {
  const category = isSearchResultCategory(row.__searchCategory) ? row.__searchCategory : "entities";
  if (category === "entities") {
    return firstSourceValue(row.entity_type, row.entityType, row.type) || "Not disclosed";
  }
  if (category === "opportunities") {
    return firstSourceValue(row.record_type, row.opportunity_type, row.type) || "Not disclosed";
  }
  if (category === "transactions") {
    return firstSourceValue(row.transaction_type, row.acquisition_type, row.deal_type, row.type) || "Transaction";
  }
  if (category === "news") {
    return firstSourceValue(row.record_type, row.article_type, row.type) || "News or Article";
  }
  return firstSourceValue(row.record_type, row.type) || "Person";
}

export function searchResultCategoryCounts(rows: readonly SearchResultRow[]): Record<"all" | SearchResultCategory, number> {
  const counts: Record<"all" | SearchResultCategory, number> = {
    all: rows.length,
    entities: 0,
    transactions: 0,
    opportunities: 0,
    news: 0,
    people: 0,
  };
  for (const row of rows) {
    if (isSearchResultCategory(row.__searchCategory)) counts[row.__searchCategory] += 1;
  }
  return counts;
}

function isSearchResultCategory(value: unknown): value is SearchResultCategory {
  return SEARCH_RESULT_CATEGORY_ORDER.includes(value as SearchResultCategory);
}

function firstSourceValue(...values: unknown[]): string {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean && !/^(?:not disclosed|unavailable|loading)$/i.test(clean)) return clean;
  }
  return "";
}
