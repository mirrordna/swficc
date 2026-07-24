export const MIN_TEXT_QUERY_CHARACTERS = 3;

export type TextQueryEligibility = "idle" | "short_query" | "ready";

export function normalizeTextQuery(value: string): string {
  return value.trim();
}

export function isTextQueryReady(value: string): boolean {
  return normalizeTextQuery(value).length >= MIN_TEXT_QUERY_CHARACTERS;
}

export function isShortTextQuery(value: string): boolean {
  const length = normalizeTextQuery(value).length;
  return length > 0 && length < MIN_TEXT_QUERY_CHARACTERS;
}

export function eligibleTextQuery(value: string): string {
  const clean = normalizeTextQuery(value);
  return clean.length >= MIN_TEXT_QUERY_CHARACTERS ? clean : "";
}

export function textQueryEligibility(value: string): TextQueryEligibility {
  const clean = normalizeTextQuery(value);
  if (!clean) return "idle";
  return clean.length < MIN_TEXT_QUERY_CHARACTERS ? "short_query" : "ready";
}
