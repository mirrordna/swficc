export type SearchKind = "entity" | "person" | "transaction" | "rfp" | "news";

// Canonical-name aliases: common acronyms/short forms clients type, mapped to the exact
// entity name that carries the record (verified present with transactions in the source).
// A query hitting one of these pins that canonical entity to the top of the results (see
// searchRelevanceScore) so an exact match on a short/side name cannot outrank the real fund.
const QUERY_SYNONYMS: Record<string, string[]> = {
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
};

const SHORT_QUERY_MAX = 3;

export function businessSearchQueryVariants(query: string): string[] {
  const clean = query.trim();
  if (!clean) return [];
  const normalized = normalizeSearchText(clean);
  const variants = [clean, ...(QUERY_SYNONYMS[normalized] || [])];
  return uniqueStrings(variants).slice(0, 3);
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

export function rankSearchRecords<T extends Record<string, unknown>>(sourceRows: T[], query: string, kind: SearchKind = "entity"): T[] {
  const clean = query.trim();
  if (!clean) return sourceRows;
  return sourceRows
    .map((row, index) => ({
      row,
      index,
      score: searchRelevanceScore(row, clean, kind),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
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
  const name = normalizeSearchText(text(row.name || row.title || row.institution || row.buyer_entity, ""));
  const slug = normalizeSearchText(text(row.slug || "", "").replaceAll("-", " "));
  const shortQuery = clean.length <= SHORT_QUERY_MAX;
  const acronym = acronymForName(name);
  const aliasTargets = (QUERY_SYNONYMS[clean] || []).map(normalizeSearchText);
  if (name === clean || slug === clean) return true;
  if (aliasTargets.some((target) => target && name === target)) return true;
  if (shortQuery && acronym === clean.toUpperCase()) return true;
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
// the public/search order). The INTERIM business hierarchy is applied as a stable secondary tiebreak that
// only reorders rows left as ties and never demotes a strong exact/prefix/acronym match. Weak-substring
// junk is suppressed only when a strong match also exists.
export function mergeSearchRecordsPreferPrimary<T extends Record<string, unknown>>(
  primaryRows: T[],
  appendRows: T[],
  query: string,
  kind: SearchKind = "entity",
): T[] {
  const clean = query.trim();
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

  const STRONG_TIER_FLOOR = 100;
  const decorated = merged.map((row, index) => {
    const strong = isStrongNameMatch(row, clean, kind);
    return {
      row,
      index,
      strong,
      tier: strong ? STRONG_TIER_FLOOR + businessHierarchyTier(row) : businessHierarchyTier(row),
      weak: isWeakSubstringMatch(row, clean, kind),
    };
  });
  const strongCount = decorated.filter((item) => item.strong).length;
  const ordered = decorated.sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    if (a.tier !== b.tier) return b.tier - a.tier;
    return a.index - b.index;
  });
  const suppressed = ordered.filter((item) => !(item.weak && strongCount > 0));
  return (suppressed.length ? suppressed : ordered).map((item) => item.row);
}

export function searchRelevanceScore(row: Record<string, unknown>, query: string, kind: SearchKind = "entity"): number {
  const clean = normalizeSearchText(query);
  if (!clean) return 0;
  const name = normalizeSearchText(text(row.name || row.title || row.institution || row.buyer_entity, ""));
  const slug = normalizeSearchText(text(row.slug || "", "").replaceAll("-", " "));
  const type = normalizeSearchText(text(row.type || row.entity_type || row.asset_class_or_strategy || row.strategy, ""));
  const country = normalizeSearchText(text(row.country || "", ""));
  const region = normalizeSearchText(text(row.region || "", ""));
  const all = normalizeSearchText(Object.values(row).filter((value) => typeof value === "string").join(" "));
  const terms = clean.split(/\s+/).filter(Boolean);
  const shortQuery = clean.length <= SHORT_QUERY_MAX;
  const acronym = acronymForName(name);
  const aliasTargets = (QUERY_SYNONYMS[clean] || []).map(normalizeSearchText);

  // Canonical alias pin: when the query is a known acronym/short form (ADIA, CIC,
  // "JP Morgan", CalPERS...), the mapped canonical entity must win outright - an exact
  // match on a short/side name (e.g. an entity literally named "Adia") must NOT outrank
  // Abu Dhabi Investment Authority. Return a score no name-match combination can reach,
  // ordered among multiple aliases by prominence.
  if (aliasTargets.some((target) => target && name === target)) {
    return 100000 + businessHierarchyScore(type) + capitalScaleScore(row);
  }

  let baseScore = 0;
  if (name === clean) baseScore += 3000;
  if (slug === clean) baseScore += 2600;
  if (shortQuery && acronym === clean.toUpperCase()) baseScore += 2400;
  if (shortQuery && tokenStartsWith(name, clean)) baseScore += 700;
  if (!shortQuery && name.startsWith(clean)) baseScore += 1000;
  if (!shortQuery && name.includes(clean)) baseScore += 620;
  if (terms.length && terms.every((term) => name.includes(term))) baseScore += 700;
  if (!shortQuery && terms.length && terms.every((term) => all.includes(term))) baseScore += 240;
  if (country.includes(clean) || region.includes(clean)) baseScore += 120;
  if (kind === "transaction" && text(row.buyer_entity || row.seller_entity || "", "").toLowerCase().includes(clean)) baseScore += 360;
  if (kind === "person" && text(row.title || row.institution || "", "").toLowerCase().includes(clean)) baseScore += 260;
  if (kind === "rfp" && text(row.strategy || row.asset_class_or_strategy || "", "").toLowerCase().includes(clean)) baseScore += 220;
  if (kind === "news" && text(row.source || "", "").toLowerCase().includes(clean)) baseScore += 160;

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

function acronymForName(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part && !/^(and|of|the|for|in|group|company|corporation|corp|limited|ltd|llc|plc)$/.test(part))
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
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
