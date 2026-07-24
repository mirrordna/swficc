export type EntityLifecycleIntent = {
  entityStatus: "active" | "defunct";
  sourceQuery: string;
  explicitDefunctRequest: boolean;
};

const DEFUNCT_INTENT_PATTERNS = [
  /\bdefunct\b/gi,
  /\bno\s+longer\s+active\b/gi,
  /\binactive\s+(?=(?:entities|institutions|funds|investors)\b)/gi,
  /\bdissolved\s+(?=(?:entities|institutions|funds|investors)\b)/gi,
];

export function entityLifecycleIntent(query: string): EntityLifecycleIntent {
  const original = query.trim();
  const explicitDefunctRequest = DEFUNCT_INTENT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(original);
  });
  if (!explicitDefunctRequest) {
    return { entityStatus: "active", sourceQuery: original, explicitDefunctRequest: false };
  }

  const sourceQuery = DEFUNCT_INTENT_PATTERNS.reduce((value, pattern) => {
    pattern.lastIndex = 0;
    return value.replace(pattern, " ");
  }, original)
    .replace(/\s+/g, " ")
    .trim();

  return { entityStatus: "defunct", sourceQuery, explicitDefunctRequest: true };
}
