export const MIN_COMPARISON_PEERS = 2;
export const MAX_COMPARISON_PEERS = 4;

export type ComparisonSelectionContext =
  | { state: "none"; ids: []; issue: "" }
  | { state: "valid"; ids: string[]; issue: "" }
  | { state: "invalid"; ids: []; issue: string };

export function comparisonSelectionFromParams(params: Pick<URLSearchParams, "get">): ComparisonSelectionContext {
  const raw = params.get("ids");
  if (raw == null || raw.trim() === "") return { state: "none", ids: [], issue: "" };
  const parts = raw.split(",").map((value) => value.trim());
  if (parts.some((value) => !/^[a-f0-9]{24}$/i.test(value))) {
    return invalid("Every comparison institution must use a canonical 24-character SWFI entity ID.");
  }
  if (new Set(parts.map((value) => value.toLowerCase())).size !== parts.length) {
    return invalid("The shared comparison contains a duplicate institution ID.");
  }
  if (parts.length < MIN_COMPARISON_PEERS || parts.length > MAX_COMPARISON_PEERS) {
    return invalid(`A shared comparison must contain ${MIN_COMPARISON_PEERS} to ${MAX_COMPARISON_PEERS} institutions.`);
  }
  return { state: "valid", ids: parts, issue: "" };
}

export function patchComparisonSelectionUrl(href: string, ids: string[]): string {
  const url = new URL(href, "https://dashboard.swfi.com");
  if (ids.length >= MIN_COMPARISON_PEERS && ids.length <= MAX_COMPARISON_PEERS) url.searchParams.set("ids", ids.join(","));
  else url.searchParams.delete("ids");
  return `${url.pathname}${url.search}${url.hash}`;
}

function invalid(issue: string): ComparisonSelectionContext {
  return { state: "invalid", ids: [], issue };
}
