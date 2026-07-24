// Record / data-view table sort defaults for SourceListPage.
//
// Extracted from the component so source-backed ordering rules are
// unit-testable. Native-currency AUM must not be compared as though every
// value shared one currency.
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
  // Active Allocators is the approved completed buyer/acquirer ranking:
  // activity count first, then disclosed deal value, then latest date.
  if (kind === "allocators") return 4;
  // Institutions are a directory, not the canonical AUM ranking. The entity
  // source mixes native currencies and exposes no verified global AUM sort,
  // so the safe directory default is Entity Name ascending.
  if (kind === "profiles") return 0;
  // The verified recent-transactions contract is reverse chronological.
  // Keep the visible header aligned with that source order by default.
  if (kind === "transactions") return 8;
  // The open RFP / Opportunity source is ordered by deadline soonest first.
  // The visible table keeps that order on each loaded page.
  if (kind === "mandates") return 5;
  // News and intelligence tables expose Published as column 1 and must lead
  // with the newest sourced date rather than alphabetizing the current page.
  if (kind === "research" || kind === "intelligence") return 1;
  return 0;
}

// Direction the table sorts by on first render.
export function defaultSortDir(kind: Kind): "asc" | "desc" {
  return kind === "allocators" || kind === "transactions" || kind === "research" || kind === "intelligence" ? "desc" : "asc";
}
