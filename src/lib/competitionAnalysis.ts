import { sourceRecordIdFor } from "@/lib/detailRoutes";
import {
  isFact,
  normalizeSwfiUrl,
  packetData,
  rows,
  SOURCE_GAP,
  type Packet,
  type Row,
} from "@/lib/sourcePackets";

export const MAX_COMPARISON_PEERS = 4;
export const COMPARISON_TRANSACTION_SAMPLE_LIMIT = 25;

type AllocationDefinition = {
  label: string;
  keys: string[];
};

export type AllocationEntry = {
  label: string;
  display: string;
  percent: number | null;
};

export type CompetitionEvidence = {
  id: string;
  label: string;
  detail: string;
  basis: "coverage" | "transactions" | "allocation";
};

export type TransactionRegionEntry = {
  region: string;
  count: number;
};

const ALLOCATION_DEFINITIONS: AllocationDefinition[] = [
  { label: "Public Equity", keys: ["Public Equity", "Public Equities", "publicEquity", "public_equity"] },
  { label: "Fixed Income", keys: ["Fixed Income", "fixedIncome", "fixed_income"] },
  { label: "Private Equity", keys: ["Private Equity", "privateEquity", "private_equity"] },
  { label: "Private Credit", keys: ["Private Credit", "privateCredit", "private_credit"] },
  { label: "Real Estate", keys: ["Real Estate", "realEstate", "real_estate"] },
  { label: "Infrastructure", keys: ["Infrastructure", "infrastructure"] },
  { label: "Hedge Funds", keys: ["Hedge Funds", "hedgeFunds", "hedge_funds"] },
  { label: "Natural Resources", keys: ["Natural Resources", "naturalResources", "natural_resources"] },
  { label: "Cash", keys: ["Cash", "cash"] },
  { label: "Other", keys: ["Other", "other"] },
];

export function comparisonSourceUrl(row: Row): string {
  for (const key of ["source_url", "swfi_url", "url"]) {
    const value = cleanText(row[key]);
    if (/^https?:\/\//i.test(value)) {
      const normalized = normalizeSwfiUrl(value);
      if (sourceRecordIdFor(normalized, "entities")) return normalized;
    }
  }
  return "";
}

export function comparisonEntityId(row: Row): string {
  const direct = [row.entity_id, row.entityID, row.source_record_id, row.id]
    .map(cleanText)
    .find((value) => /^[a-f0-9]{24}$/i.test(value));
  return direct || sourceRecordIdFor(comparisonSourceUrl(row), "entities");
}

export function comparisonPeerKey(row: Row): string {
  return comparisonEntityId(row);
}

export function comparisonName(row: Row): string {
  return cleanText(row.name || row.institution || row.legal_name) || "Not disclosed";
}

export function comparisonPeerType(row: Row): string {
  return cleanText(row.type || row.entity_type) || "Not disclosed";
}

export function comparisonPeerTypeKey(row: Row): string {
  return cleanText(row.type || row.entity_type).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function dedupeComparisonRows(sourceRows: Row[]): Row[] {
  const seen = new Set<string>();
  return sourceRows.filter((row) => {
    const key = comparisonPeerKey(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function defaultComparisonPeers(sourceRows: Row[], limit = 3): Row[] {
  const candidates = dedupeComparisonRows(sourceRows);
  const anchor = candidates[0];
  if (!anchor) return [];
  const anchorType = comparisonPeerTypeKey(anchor);
  if (!anchorType) return [];
  return candidates.filter((row) => comparisonPeerTypeKey(row) === anchorType).slice(0, limit);
}

export function hydrateComparisonPeer(row: Row, packet?: Packet): Row {
  const profile = isFact(packet) ? packetData(packet).profile : null;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return row;
  const hydrated = profile as Row;
  return {
    ...row,
    ...hydrated,
    source_url: comparisonSourceUrl(hydrated) || comparisonSourceUrl(row),
    swfi_url: cleanText(hydrated.swfi_url || row.swfi_url),
  };
}

export function comparisonStrategy(row: Row, maxLength = 240): string {
  const fields = moduleFields(row, "strategy");
  const value = cleanText(fields.Strategy || fields.strategy || row.strategy);
  if (!value) return "Not disclosed";
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function comparisonAllocationEntries(row: Row): AllocationEntry[] {
  const strategyFields = moduleFields(row, "strategy");
  const assetFields = moduleFields(row, "assets");
  const nested = objectValue(assetFields.asset_allocation || assetFields["Asset Allocation"] || row.asset_allocation);
  return ALLOCATION_DEFINITIONS.flatMap((definition) => {
    const raw = firstDefinedValue(definition.keys, [strategyFields, nested, assetFields, row]);
    const formatted = formatAllocation(raw);
    return formatted ? [{ label: definition.label, ...formatted }] : [];
  });
}

export function comparisonTransactionTotal(packet?: Packet): number | null {
  if (!isFact(packet)) return null;
  const value = packetData(packet).total_transactions ?? packetData(packet).count;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function comparisonTransactionRegions(packet?: Packet): TransactionRegionEntry[] {
  const counts = new Map<string, number>();
  transactionRegions(packet).forEach((region) => counts.set(region, (counts.get(region) || 0) + 1));
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((left, right) => right.count - left.count || left.region.localeCompare(right.region));
}

export function competitionEvidenceQuestions(
  peers: Row[],
  transactionPackets: Record<string, Packet>,
  buyerActivityPackets: Record<string, Packet> = transactionPackets,
): CompetitionEvidence[] {
  if (peers.length < 2) return [];
  const anchor = peers[0];
  const peerRows = peers.slice(1);
  const evidence: CompetitionEvidence[] = [];

  const anchorAllocations = new Map(comparisonAllocationEntries(anchor).map((entry) => [entry.label, entry]));
  for (const definition of ALLOCATION_DEFINITIONS) {
    if (anchorAllocations.has(definition.label)) continue;
    const disclosingPeers = peerRows.filter((peer) => comparisonAllocationEntries(peer).some((entry) => entry.label === definition.label));
    if (disclosingPeers.length < 2) continue;
    evidence.push({
      id: `coverage-${slugify(definition.label)}`,
      label: `${definition.label} coverage gap`,
      detail: `${disclosingPeers.length} peers disclose ${definition.label}; ${comparisonName(anchor)} does not. This is a source-coverage gap, not a zero allocation.`,
      basis: "coverage",
    });
    if (evidence.filter((item) => item.basis === "coverage").length >= 2) break;
  }

  const allocationSpreads = ALLOCATION_DEFINITIONS.flatMap((definition) => {
    const values = peers.flatMap((peer) => {
      const entry = comparisonAllocationEntries(peer).find((candidate) => candidate.label === definition.label);
      return entry?.percent == null ? [] : [entry.percent];
    });
    if (values.length < 2) return [];
    const low = Math.min(...values);
    const high = Math.max(...values);
    return high - low >= 5 ? [{ definition, low, high, count: values.length }] : [];
  }).sort((left, right) => (right.high - right.low) - (left.high - left.low));
  const topSpread = allocationSpreads[0];
  if (topSpread) {
    evidence.push({
      id: `allocation-spread-${slugify(topSpread.definition.label)}`,
      label: `${topSpread.definition.label} peer spread`,
      detail: `Disclosed ${topSpread.definition.label} values range from ${formatPercent(topSpread.low)} to ${formatPercent(topSpread.high)} across ${topSpread.count} selected institutions. Review the difference; no recommendation is inferred.`,
      basis: "allocation",
    });
  }

  const anchorKey = comparisonPeerKey(anchor);
  const anchorPacket = transactionPackets[anchorKey];
  const anchorRegions = new Set(transactionRegions(buyerActivityPackets[anchorKey]));
  const regionalEvidence = new Map<string, { institutions: Set<string>; transactions: number }>();
  peerRows.forEach((peer) => {
    const peerKey = comparisonPeerKey(peer);
    transactionRegions(buyerActivityPackets[peerKey]).forEach((region) => {
      const current = regionalEvidence.get(region) || { institutions: new Set<string>(), transactions: 0 };
      current.institutions.add(peerKey);
      current.transactions += 1;
      regionalEvidence.set(region, current);
    });
  });
  const regionalQuestion = [...regionalEvidence.entries()]
    .filter(([region, proof]) => proof.institutions.size >= 2 && !anchorRegions.has(region))
    .sort((left, right) => right[1].transactions - left[1].transactions)[0];
  if (regionalQuestion) {
    const [region, proof] = regionalQuestion;
    evidence.push({
      id: `regional-${slugify(region)}`,
      label: `${region} activity question`,
      detail: `Across the latest up to ${COMPARISON_TRANSACTION_SAMPLE_LIMIT} source-linked transactions loaded per institution, ${proof.institutions.size} peers have ${proof.transactions} ${region} transactions while ${comparisonName(anchor)} has none in its loaded sample. This is a review question, not proof of inactivity.`,
      basis: "transactions",
    });
  }

  const anchorTotal = comparisonTransactionTotal(anchorPacket);
  const peerTotals = peerRows
    .map((peer) => comparisonTransactionTotal(transactionPackets[comparisonPeerKey(peer)]))
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);
  if (anchorTotal != null && peerTotals.length >= 2) {
    const middle = Math.floor(peerTotals.length / 2);
    const median = peerTotals.length % 2
      ? peerTotals[middle]
      : (peerTotals[middle - 1] + peerTotals[middle]) / 2;
    if (anchorTotal < median) {
      evidence.push({
        id: "transaction-total-review",
        label: "Transaction coverage review",
        detail: `${comparisonName(anchor)} has ${anchorTotal.toLocaleString("en-US")} source-linked transactions versus a selected-peer median of ${median.toLocaleString("en-US")}. Review whether the difference reflects activity or record coverage.`,
        basis: "transactions",
      });
    }
  }

  return evidence.slice(0, 5);
}

function moduleFields(row: Row, moduleName: string): Row {
  const modules = objectValue(row.modules);
  const sourceModule = objectValue(modules[moduleName]);
  return objectValue(sourceModule.fields);
}

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function firstDefinedValue(keys: string[], containers: Row[]): unknown {
  for (const container of containers) {
    for (const key of keys) {
      const value = container[key];
      if (value != null && cleanText(value) && !isNotDisclosed(value)) return value;
    }
  }
  return null;
}

function formatAllocation(value: unknown): { display: string; percent: number | null } | null {
  if (value == null || isNotDisclosed(value)) return null;
  const displayText = cleanText(value);
  if (!displayText) return null;
  const percent = allocationPercent(value);
  if (/^-?\d+(?:\.\d+)?\s*%$/.test(displayText) && percent == null) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(displayText) && percent != null) {
    return { display: formatPercent(percent), percent };
  }
  return { display: displayText.length > 80 ? `${displayText.slice(0, 79)}…` : displayText, percent };
}

function allocationPercent(value: unknown): number | null {
  if (typeof value === "number") return normalizePercent(value);
  const clean = cleanText(value).replace(/[–—]/g, "-");
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return normalizePercent(Number(clean));
  // A disclosed range is preserved for display, but is not collapsed into a
  // midpoint for comparison evidence. That midpoint would be our derivation,
  // not a source value.
  const range = clean.match(/(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)\s*%/i);
  if (range) return null;
  const single = clean.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return single ? normalizePercent(Number(single[1])) : null;
}

function normalizePercent(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value * 100;
  return value <= 100 ? value : null;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function transactionRegions(packet?: Packet): string[] {
  if (!isFact(packet)) return [];
  return rows(packet)
    .map((row) => cleanText(row.region || row.buyer_region))
    .filter((region) => region && !isNotDisclosed(region));
}

function isNotDisclosed(value: unknown): boolean {
  const clean = cleanText(value).toLowerCase();
  return !clean || clean === SOURCE_GAP.toLowerCase() || clean === "not disclosed" || clean === "n/a";
}

function cleanText(value: unknown): string {
  if (value == null || typeof value === "object") return "";
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
