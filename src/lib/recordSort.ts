// Record / data-view table sort defaults for SourceListPage.
//
// Directory AUM is source-reported and may use different currencies. It must
// not be presented as one cross-currency ranking; the dashboard's dedicated
// top-AUM feed is the only USD-ranked surface.
// Regression test: scripts/swfipn-record-sort-defaults-test.mjs.

export type Kind =
  | "profiles"
  | "people"
  | "transactions"
  | "deals"
  | "allocators"
  | "comparisons"
  | "mandates"
  | "alerts"
  | "research"
  | "intelligence"
  | "search";

// Column index the table sorts by on first render.
export function defaultSortColumn(kind: Kind): number {
  // Allocators default to "Most Recent Activity Date" (column index 6) so the
  // reverse-chronological server sort and the header indicator agree.
  if (kind === "allocators") return 6;
  // News and intelligence tables expose Published as column 1 and must lead
  // with the newest sourced date rather than alphabetizing the current page.
  if (kind === "research" || kind === "intelligence") return 1;
  return 0;
}

// Direction the table sorts by on first render.
export function defaultSortDir(kind: Kind): "asc" | "desc" {
  return kind === "allocators" || kind === "research" || kind === "intelligence" ? "desc" : "asc";
}

export function isSortableRecordColumn(kind: Kind, column: string): boolean {
  const normalized = column.trim().toLowerCase();
  if ((kind === "profiles" || kind === "comparisons" || kind === "allocators") && normalized.includes("aum")) {
    return false;
  }
  return true;
}
