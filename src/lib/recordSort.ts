// Record / data-view table sort defaults for SourceListPage.
//
// Extracted from the component so the "Top Ranked AUM" default (profiles
// tables lead with AUM descending — KP/Jaykesh feedback 2026-07-07/13) is
// unit-testable and cannot silently regress to Entity-Name-ascending.
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
  // Institutions ("profiles") lead with AUM (column index 3 of
  // ["Entity Name", "Type", "Country", "AUM"]) so a "Top Ranked AUM" table
  // shows the largest asset owners first instead of an A–Z name list. "Not
  // disclosed" AUM sinks to the bottom via compareCells regardless of direction.
  if (kind === "profiles") return 3;
  // News and intelligence tables expose Published as column 1 and must lead
  // with the newest sourced date rather than alphabetizing the current page.
  if (kind === "research" || kind === "intelligence") return 1;
  return 0;
}

// Direction the table sorts by on first render.
export function defaultSortDir(kind: Kind): "asc" | "desc" {
  return kind === "allocators" || kind === "profiles" || kind === "research" || kind === "intelligence" ? "desc" : "asc";
}
