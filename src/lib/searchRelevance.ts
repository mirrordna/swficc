export type SearchKind = "entity" | "person" | "transaction" | "rfp" | "news";

const QUERY_SYNONYMS: Record<string, string[]> = {
  adia: ["Abu Dhabi Investment Authority"],
  adq: ["Abu Dhabi Developmental Holding Company"],
  cic: ["China Investment Corporation"],
  gpfg: ["Government Pension Fund Global"],
  gpif: ["Government Pension Investment Fund Japan"],
  pif: ["Public Investment Fund"],
  qia: ["Qatar Investment Authority"],
  safe: ["State Administration of Foreign Exchange"],
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

  let baseScore = 0;
  if (name === clean) baseScore += 3000;
  if (slug === clean) baseScore += 2600;
  if (aliasTargets.some((target) => target && name === target)) baseScore += 2800;
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
