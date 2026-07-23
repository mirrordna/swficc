export type SearchKind = "entity" | "person" | "transaction" | "rfp" | "news";

const SHORT_QUERY_MAX = 3;
const ACRONYM_MIN = 2;
const ACRONYM_MAX = 12;
const CONNECTOR_WORDS = new Set(["and", "of", "the", "for", "in", "de", "del", "du", "et", "la", "le"]);
const LEGAL_SUFFIX_WORDS = new Set(["company", "corporation", "corp", "limited", "ltd", "llc", "plc"]);
const SOURCE_ALIAS_FIELDS = [
  "alias",
  "aliases",
  "acronym",
  "acronyms",
  "abbreviation",
  "abbreviations",
  "short_name",
  "shortName",
  "legal_name",
  "legalName",
  "dba",
  "former_names",
  "formerNames",
] as const;

// Verified query-routing aliases for names the SWFI search APIs do not derive from the
// stored display name. These values choose which canonical name to query; they never
// populate or replace a displayed business fact.
const VERIFIED_QUERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  adia: ["Abu Dhabi Investment Authority"],
  adq: ["Abu Dhabi Developmental Holding Company"],
  cic: ["China Investment Corporation"],
  gpfg: ["Government Pension Fund Global"],
  gpif: ["Government Pension Investment Fund Japan"],
  pif: ["Public Investment Fund"],
  qia: ["Qatar Investment Authority"],
  safe: ["State Administration of Foreign Exchange"],
  "jp morgan": ["JPMorgan Chase & Co"],
  jpmorgan: ["JPMorgan Chase & Co"],
  calpers: ["California Public Employees Retirement System"],
  nbim: ["Norway Government Pension Fund Global"],
  norges: ["Norway Government Pension Fund Global"],
  aimco: ["Alberta Investment Management Corporation"],
  icd: ["Investment Corporation of Dubai"],
  kic: ["Korea Investment Corporation"],
  "sovereign wealth funds": ["Sovereign Wealth Fund"],
  "pension funds": ["Public Pension"],
  "family offices": ["Family Office"],
};

export function businessSearchQueryVariants(query: string, sourceRows: Record<string, unknown>[] = []): string[] {
  const clean = searchSubjectQuery(query);
  if (!clean) return [];
  const variants = [clean, ...canonicalAliasTargets(clean)];
  for (const row of sourceRows) {
    if (!isSourceBackedAliasMatch(row, clean)) continue;
    const canonicalName = primarySearchName(row);
    if (canonicalName) variants.push(canonicalName);
  }
  return uniqueStrings(variants).slice(0, 3);
}

export function verifiedCanonicalSearchName(
  query: string,
  sourceRows: Record<string, unknown>[],
): string {
  const canonicalTargets = businessSearchQueryVariants(query).slice(1);
  for (const target of canonicalTargets) {
    const match = sourceRows.find((row) => (
      primarySearchName(row).localeCompare(target, undefined, { sensitivity: "base" }) === 0
    ));
    if (match) return primarySearchName(match);
  }
  return "";
}

export function dedupeSearchRecords<T extends Record<string, unknown>>(sourceRows: T[]): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const row of sourceRows) {
    const key = searchRecordKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
}

export function prioritizeSearchRecords<T extends Record<string, unknown>>(
  sourceRows: T[],
  leadingRows: T[],
): T[] {
  const currentByKey = new Map(sourceRows.map((row) => [searchRecordKey(row), row]));
  const prioritized = leadingRows.map((leadingRow) => {
    const current = currentByKey.get(searchRecordKey(leadingRow));
    return current ? { ...leadingRow, ...current } as T : leadingRow;
  });
  return dedupeSearchRecords([...prioritized, ...sourceRows]);
}

export function rankSearchRecords<T extends Record<string, unknown>>(sourceRows: T[], query: string, kind: SearchKind = "entity"): T[] {
  const clean = searchSubjectQuery(query);
  if (!clean) return sourceRows;
  return sourceRows
    .map((row, index) => ({
      row,
      index,
      score: searchRelevanceScore(row, clean, kind),
      key: searchRecordKey(row),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" })
      || a.index - b.index
    ))
    .map((item) => item.row);
}

// INTERIM hierarchy pending the official ordering list from the data team.
// Coarse business/customer hierarchy tier used ONLY as a stable secondary tiebreak. Higher sorts first.
// Sovereign Wealth Fund > Public Pension/Pension > Government Fund/SOE/Development Bank/Bank > Company/Other.
export function businessHierarchyTier(row: Record<string, unknown>): number {
  const type = normalizeSearchText(text(row.type || row.entity_type || row.asset_class_or_strategy || row.strategy, ""));
  if (/sovereign wealth fund/.test(type)) return 6;
  if (/public pension|pension fund|pension/.test(type)) return 5;
  if (/government fund|investment authority|central bank/.test(type)) return 4;
  if (/development bank|state owned enterprise|state-owned enterprise|sovereign owned|soe/.test(type)) return 3;
  if (/bank|insurance|asset manager|fund manager|advisor|nonbank/.test(type)) return 2;
  if (/government/.test(type)) return 1;
  return 0;
}

// True when the query is a strong name match (exact / slug-exact / alias-exact / acronym for a short
// query / prefix / all multi-word terms present as name tokens). Such rows must not be demoted by the
// hierarchy tiebreak nor dropped by junk suppression.
export function isStrongNameMatch(row: Record<string, unknown>, query: string, kind: SearchKind = "entity"): boolean {
  const clean = normalizeSearchText(query);
  if (!clean) return false;
  const name = normalizeSearchText(primarySearchName(row));
  const slug = normalizeSearchText(text(row.slug || "", "").replaceAll("-", " "));
  const shortQuery = clean.length <= SHORT_QUERY_MAX;
  const canonicalTargets = canonicalAliasTargets(query).map(normalizeSearchText);
  if (name === clean || slug === clean) return true;
  if (canonicalTargets.includes(name)) return true;
  if (explicitSourceAliases(row).some((alias) => normalizeSearchText(alias) === clean)) return true;
  if (isAcronymQuery(query) && sourceBackedSearchNames(row).some((value) => acronymMatches(value, query))) return true;
  if (shortQuery && tokenStartsWith(name, clean)) return true;
  if (!shortQuery && name.startsWith(clean)) return true;
  const terms = clean.split(/\s+/).filter(Boolean);
  if (!shortQuery && terms.length > 1 && terms.every((term) => name.includes(term))) return true;
  return kind === "entity" ? false : searchRelevanceScore(row, query, kind) > 0 && name.includes(clean);
}

// True when the query only appears as an incidental substring inside a longer token (e.g. "pif" inside
// "Piffle"/"Trippifi"/"Bpifrance") with no strong name match. Callers suppress these ONLY when a strong
// match also exists (so junk sits far below); a strong match is never treated as weak.
export function isWeakSubstringMatch(row: Record<string, unknown>, query: string, kind: SearchKind = "entity"): boolean {
  const clean = normalizeSearchText(query);
  if (!clean) return false;
  if (isStrongNameMatch(row, query, kind)) return false;
  const name = normalizeSearchText(text(row.name || row.title || row.institution || row.buyer_entity, ""));
  if (!name) return false;
  return name.includes(clean) && !tokenStartsWith(name, clean);
}

// Search merge intent: treat /api/v1/public/search order as the primary ordering source. Entities from
// the /api/source-data collection are appended only when not already present (they must not reorder above
// the public/search order). Appended records are relevance-ranked before being added. Weak-substring junk
// is suppressed only when a strong match also exists, without changing the canonical primary order.
export function mergeSearchRecordsPreferPrimary<T extends Record<string, unknown>>(
  primaryRows: T[],
  appendRows: T[],
  query: string,
  kind: SearchKind = "entity",
): T[] {
  const clean = searchSubjectQuery(query);
  const primary = dedupeSearchRecords(primaryRows);
  const seen = new Set(primary.map((row) => searchRecordKey(row)));
  const appended = rankSearchRecords(dedupeSearchRecords(appendRows), query, kind)
    .filter((row) => {
      const key = searchRecordKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const merged = [...primary, ...appended];
  if (!clean) return merged;

  const decorated = merged.map((row) => {
    const strong = isStrongNameMatch(row, clean, kind);
    return {
      row,
      strong,
      weak: isWeakSubstringMatch(row, clean, kind),
    };
  });
  const strongCount = decorated.filter((item) => item.strong).length;
  const suppressed = decorated.filter((item) => !(item.weak && strongCount > 0));
  return (suppressed.length ? suppressed : decorated).map((item) => item.row);
}

export function aggregateEntitySearchRecords<T extends Record<string, unknown>>(
  publicRows: T[],
  sourceRows: T[],
  query: string,
  leadingRows: T[] = [],
): T[] {
  // `/api/v1/public/search` can return a different broad-substring page for an
  // identical query. The collection endpoint is stable and canonical, so it
  // leads the refresh merge. Rows already shown in the Smart Search preview
  // are then promoted after deterministic re-ranking without overwriting live
  // source fields; otherwise a refreshed slice can push a preview item below
  // the View All category quota.
  const refreshedRows = rankSearchRecords(
    mergeSearchRecordsPreferPrimary(sourceRows, publicRows, query, "entity"),
    query,
    "entity",
  );
  return prioritizeSearchRecords(
    refreshedRows,
    rankSearchRecords(dedupeSearchRecords(leadingRows), query, "entity"),
  );
}

export function searchSubjectQuery(query: string): string {
  const clean = query.trim();
  if (!clean) return "";
  const subject = clean.replace(
    /^(?:please\s+)?(?:give|provide|show|retrieve)(?:\s+me)?(?:\s+with)?\s+(?:information|info|details|data)\s+(?:about|on|for)\s+/i,
    "",
  ).trim();
  return subject || clean;
}

export function searchRelevanceScore(row: Record<string, unknown>, query: string, kind: SearchKind = "entity"): number {
  const clean = normalizeSearchText(query);
  if (!clean) return 0;
  const name = normalizeSearchText(primarySearchName(row));
  const slug = normalizeSearchText(text(row.slug || "", "").replaceAll("-", " "));
  const type = normalizeSearchText(text(row.type || row.entity_type || row.asset_class_or_strategy || row.strategy, ""));
  const country = normalizeSearchText(text(row.country || "", ""));
  const region = normalizeSearchText(text(row.region || "", ""));
  const channels = searchChannels(row, kind).map(normalizeSearchText).filter(Boolean);
  const all = normalizeSearchText(channels.join(" "));
  const terms = clean.split(/\s+/).filter(Boolean);
  const shortQuery = clean.length <= SHORT_QUERY_MAX;
  const canonicalTargetMatch = canonicalAliasTargets(query).map(normalizeSearchText).includes(name);
  const explicitAliasMatch = explicitSourceAliases(row).some((alias) => normalizeSearchText(alias) === clean);
  const acronymMatch = isAcronymQuery(query) && sourceBackedSearchNames(row).some((value) => acronymMatches(value, query));

  // Source-provided aliases outrank incidental exact-name collisions. Product aliases are
  // never embedded here: the row must carry the alias/legal/short-name field itself.
  if (canonicalTargetMatch || explicitAliasMatch) {
    return 100000 + businessHierarchyScore(type) + capitalScaleScore(row);
  }

  let baseScore = 0;
  if (name === clean) baseScore += 3000;
  if (slug === clean) baseScore += 2600;
  if (acronymMatch) baseScore += 2400;
  if (shortQuery && tokenStartsWith(name, clean)) baseScore += 700;
  if (!shortQuery && name.startsWith(clean)) baseScore += 1000;
  if (!shortQuery && name.includes(clean)) baseScore += 620;
  if (terms.length && terms.every((term) => name.includes(term))) baseScore += 700;
  if (!shortQuery && terms.length && terms.every((term) => all.includes(term))) baseScore += 240;
  if (country.includes(clean) || region.includes(clean)) baseScore += 120;
  if (kind === "transaction" && channels.some((value) => value.includes(clean))) baseScore += 360;
  if (kind === "person" && channels.some((value) => value.includes(clean))) baseScore += 260;
  if (kind === "rfp" && channels.some((value) => value.includes(clean))) baseScore += 220;
  if (kind === "news" && channels.some((value) => value.includes(clean))) baseScore += 160;

  if (baseScore <= 0) return 0;

  return baseScore + businessHierarchyScore(type) + businessNameScore(name) + capitalScaleScore(row);
}

export function searchRecordKey(row: Record<string, unknown>): string {
  const source = text(row.source_url || row.swfi_url || row.url || row.profile_url || "", "");
  if (source) return normalizeSearchText(source);
  const id = text(row.entity_id || row.person_id || row.transaction_id || row.compass_id || row.source_record_id || row.id || "", "");
  if (id) return normalizeSearchText(id);
  return normalizeSearchText([row.name, row.title, row.institution, row.country, row.type].map((value) => text(value, "")).join("|"));
}

function businessHierarchyScore(type: string): number {
  if (/sovereign wealth fund/.test(type)) return 900;
  if (/public pension|pension fund|pension/.test(type)) return 780;
  if (/government fund|investment authority/.test(type)) return 680;
  if (/central bank/.test(type)) return 560;
  if (/development bank/.test(type)) return 500;
  if (/state owned enterprise|state-owned enterprise/.test(type)) return 380;
  if (/asset manager|fund manager|advisor/.test(type)) return 260;
  if (/insurance|bank/.test(type)) return 160;
  if (/government/.test(type)) return 120;
  return 0;
}

function businessNameScore(name: string): number {
  if (/investment authority/.test(name)) return 300;
  if (/developmental holding/.test(name)) return 220;
  if (/public investment fund/.test(name)) return 160;
  if (/pension fund/.test(name)) return 80;
  if (/investment council/.test(name)) return 50;
  return 0;
}

function capitalScaleScore(row: Record<string, unknown>): number {
  const value = numericSortValue(text(row.aum || row.assets || row.managed_assets || row.amount || row.capital || "", ""));
  if (!value || value <= 0) return 0;
  return Math.min(240, Math.round(Math.log10(value + 1) * 18));
}

function isSourceBackedAliasMatch(row: Record<string, unknown>, query: string): boolean {
  const clean = normalizeSearchText(query);
  if (!clean) return false;
  if (explicitSourceAliases(row).some((alias) => normalizeSearchText(alias) === clean)) return true;
  return isAcronymQuery(query) && sourceBackedSearchNames(row).some((value) => acronymMatches(value, query));
}

function canonicalAliasTargets(query: string): string[] {
  return [...(VERIFIED_QUERY_ALIASES[normalizeSearchText(query)] || [])];
}

function primarySearchName(row: Record<string, unknown>): string {
  return text(row.name || row.title || row.institution || row.buyer_entity, "");
}

function sourceBackedSearchNames(row: Record<string, unknown>): string[] {
  return uniqueStrings([
    primarySearchName(row),
    text(row.slug, "").replaceAll("-", " "),
    ...explicitSourceAliases(row),
  ]);
}

function explicitSourceAliases(row: Record<string, unknown>): string[] {
  const aliases: string[] = [];
  for (const key of SOURCE_ALIAS_FIELDS) {
    const value = row[key];
    if (Array.isArray(value)) {
      aliases.push(...value.filter((item): item is string => typeof item === "string"));
    } else if (typeof value === "string") {
      aliases.push(value);
      for (const match of value.matchAll(/\(([^)]+)\)/g)) aliases.push(match[1]);
    }
  }
  return uniqueStrings(aliases);
}

function searchChannels(row: Record<string, unknown>, kind: SearchKind): string[] {
  const channels = sourceBackedSearchNames(row);
  const fields = kind === "transaction"
    ? ["buyer_entity", "seller_entity", "institution", "industry", "sector", "investment_type", "country", "region", "announced_at", "closed_at"]
    : kind === "person"
      ? ["title", "institution", "city", "country", "region"]
      : kind === "rfp"
        ? ["institution", "strategy", "asset_class_or_strategy", "country", "region"]
        : kind === "news"
          ? ["source", "excerpt", "summary", "country", "region"]
          : ["type", "entity_type", "country", "region"];
  for (const key of fields) {
    const value = row[key];
    if (typeof value === "string") channels.push(value);
  }
  if (kind === "transaction") {
    for (const key of ["buyer_entities", "seller_entities"]) {
      const values = row[key];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (value && typeof value === "object") channels.push(text((value as Record<string, unknown>).name, ""));
      }
    }
  }
  return uniqueStrings(channels);
}

function isAcronymQuery(value: string): boolean {
  const compact = value.trim().replace(/[^a-z0-9]/gi, "");
  return compact.length >= ACRONYM_MIN
    && compact.length <= ACRONYM_MAX
    && /^[a-z][a-z0-9]*$/i.test(compact)
    && !/\s/.test(value.trim());
}

function acronymMatches(value: string, query: string): boolean {
  const target = query.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!target) return false;
  return acronymCandidates(value).some((candidate) => (
    candidate === target
    || (target.length >= 3 && candidate.length > target.length && candidate.startsWith(target))
  ));
}

function acronymCandidates(value: string): string[] {
  const normalizedWords = normalizeSearchText(value).split(/\s+/).filter(Boolean);
  if (!normalizedWords.length) return [];
  const significantWords = normalizedWords.filter((word) => !CONNECTOR_WORDS.has(word));
  const withoutLegalSuffix = significantWords.filter((word) => !LEGAL_SUFFIX_WORDS.has(word));
  const candidates = [
    significantWords.map((word) => word[0]).join(""),
    withoutLegalSuffix.map((word) => word[0]).join(""),
  ];
  const lastWord = significantWords.at(-1) || "";
  if (LEGAL_SUFFIX_WORDS.has(lastWord)) {
    const stem = withoutLegalSuffix.map((word) => word[0]).join("");
    candidates.push(`${stem}co`, `${stem}${lastWord[0]}`);
  }
  if (withoutLegalSuffix.length > 1) {
    const rest = withoutLegalSuffix.slice(1).map((word) => word[0]).join("");
    for (const prefixLength of [2, 3, 4]) {
      if (withoutLegalSuffix[0].length >= prefixLength) candidates.push(`${withoutLegalSuffix[0].slice(0, prefixLength)}${rest}`);
    }
    const initials = withoutLegalSuffix.map((word) => word[0]).join("");
    const finalWord = withoutLegalSuffix.at(-1) || "";
    if (finalWord.length > 1) candidates.push(`${initials}${finalWord.at(-1)}`);
  }
  for (const token of value.match(/[A-Za-z0-9]+/g) || []) {
    if (/^[A-Z][A-Z0-9]{1,11}$/.test(token)) candidates.push(token);
  }
  return uniqueStrings(candidates).map((candidate) => candidate.replace(/[^a-z0-9]/gi, "").toUpperCase()).filter(Boolean);
}

function tokenStartsWith(value: string, query: string): boolean {
  return value.split(/\s+/).some((part) => part.startsWith(query));
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = normalizeSearchText(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    next.push(clean);
  }
  return next;
}

function text(value: unknown, fallback = ""): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function numericSortValue(value: string): number | null {
  const textValue = value.trim();
  if (!textValue || /not disclosed|unavailable/i.test(textValue)) return null;
  const compact = textValue.replace(/\b(usd|us\$|aum|deals?|rows?|source matches?)\b/gi, "").trim();
  const unitMatch = compact.match(/(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMBT])\b/i);
  if (unitMatch) {
    const multiplier = unitMatch[2].toUpperCase() === "K"
      ? 1_000
      : unitMatch[2].toUpperCase() === "M"
        ? 1_000_000
        : unitMatch[2].toUpperCase() === "B"
          ? 1_000_000_000
          : 1_000_000_000_000;
    return Number(unitMatch[1].replaceAll(",", "")) * multiplier;
  }
  const numericMatch = compact.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!numericMatch) return null;
  const parsed = Number(numericMatch[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}
