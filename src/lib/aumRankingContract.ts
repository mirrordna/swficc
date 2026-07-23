type Packet = Record<string, unknown>;

export const DEFAULT_AUM_RANKING_LIMIT = 25;
export const MAX_AUM_RANKING_LIMIT = 250;

export type AumRankingState = "pending" | "ready" | "empty" | "unavailable" | "invalid";

export type AumRankingContract = {
  state: AumRankingState;
  rows: Record<string, unknown>[];
  issues: string[];
  sourceTotal: number;
  activeCount: number;
  defunctCount: number;
  total: number;
};

export function aumRankingEndpoint(limit = DEFAULT_AUM_RANKING_LIMIT, includeDefunct = false): string {
  const normalizedLimit = Math.min(MAX_AUM_RANKING_LIMIT, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : DEFAULT_AUM_RANKING_LIMIT)));
  const params = new URLSearchParams({ limit: String(normalizedLimit) });
  if (includeDefunct) params.set("include_defunct", "true");
  return `/v1/swfi/top20?${params.toString()}`;
}

export function canonicalAumRankingEntityUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.swfi.com") return "";
    if (!/^\/v1\/entities\/[a-f0-9]{24}\/?$/i.test(parsed.pathname)) return "";
    if (parsed.search || parsed.hash) return "";
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return "";
  }
}

export function formatDisclosedAum(row: Record<string, unknown>): string {
  const value = finiteNumber(row.aum ?? row.assets);
  const currency = String(row.aum_currency || row.assets_currency || "").trim().toUpperCase();
  if (value === null || value <= 0 || !currency) return "Not disclosed";
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  return currency === "USD" ? `$${compact}` : `${currency} ${compact}`;
}

export function comparableAumCurrency(sourceRows: Record<string, unknown>[]): string {
  const currencies = new Set(sourceRows
    .filter((row) => (finiteNumber(row.aum ?? row.assets) ?? 0) > 0)
    .map((row) => String(row.aum_currency || row.assets_currency || "").trim().toUpperCase())
    .filter(Boolean));
  return currencies.size === 1 ? [...currencies][0] : "";
}

export function inspectAumRankingPacket(packet: Packet | undefined, requestedLimit = DEFAULT_AUM_RANKING_LIMIT): AumRankingContract {
  if (packet === undefined) return emptyContract("pending");
  if (!isFactPacket(packet)) {
    const reason = String(packet.unavailable_reason || "").trim();
    return { ...emptyContract("unavailable"), issues: reason ? [reason] : ["source_unavailable"] };
  }

  const data = record(packet.data);
  const sourceRows = Array.isArray(data.rows)
    ? data.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
  const total = finiteInteger(data.total);
  const returned = finiteInteger(data.returned);
  const sourceTotal = finiteInteger(data.source_total_count);
  const activeCount = finiteInteger(data.active_count);
  const defunctCount = finiteInteger(data.defunct_count);
  const issues: string[] = [];

  if (data.include_defunct !== false) issues.push("default_scope_must_exclude_defunct");
  if (data.entity_status_scope !== "active_only") issues.push("default_scope_must_be_active_only");
  if (data.count_basis !== "ranked_entity_status_scope") issues.push("count_basis_missing_or_unapproved");
  if (data.aum_history_status !== "available") issues.push("aum_history_not_available");
  if (total === null || activeCount === null || defunctCount === null || sourceTotal === null) issues.push("lifecycle_counts_missing");
  if (total !== null && activeCount !== null && total !== activeCount) issues.push("total_active_count_mismatch");
  if (activeCount !== null && defunctCount !== null && sourceTotal !== null && activeCount + defunctCount !== sourceTotal) issues.push("source_total_count_mismatch");
  if (returned === null || returned !== sourceRows.length) issues.push("returned_row_count_mismatch");
  if (sourceRows.length > Math.min(MAX_AUM_RANKING_LIMIT, Math.max(1, Math.trunc(requestedLimit)))) issues.push("returned_more_than_requested");

  const seenSources = new Set<string>();
  let previousAum = Number.POSITIVE_INFINITY;
  let missingAumStarted = false;
  sourceRows.forEach((row, index) => {
    const expectedRank = index + 1;
    if (finiteInteger(row.rank) !== expectedRank) issues.push(`rank_sequence_${expectedRank}`);
    if (String(row.type || row.entity_type || "") !== "Sovereign Wealth Fund") issues.push(`entity_type_${expectedRank}`);
    if (row.defunct !== false || String(row.entity_status || "") !== "active") issues.push(`active_scope_${expectedRank}`);
    if (!String(row.name || "").trim()) issues.push(`name_${expectedRank}`);
    if (!String(row.country || "").trim()) issues.push(`country_${expectedRank}`);

    const sourceUrl = canonicalAumRankingEntityUrl(row.source_url);
    if (!sourceUrl) issues.push(`source_url_${expectedRank}`);
    else if (seenSources.has(sourceUrl)) issues.push(`duplicate_source_${expectedRank}`);
    else seenSources.add(sourceUrl);

    const aumUsd = finiteNumber(row.aum_usd);
    const aum = finiteNumber(row.aum);
    const currency = String(row.aum_currency || "").trim().toUpperCase();
    if (aum !== null && aum > 0 && !currency) issues.push(`aum_currency_${expectedRank}`);
    if (aum !== null && aum > 0 && !String(row.aum_source || "").trim()) issues.push(`aum_source_${expectedRank}`);
    if (aumUsd !== null && currency && currency !== "USD" && !hasExplicitFxProvenance(row)) {
      issues.push(`fx_provenance_${expectedRank}`);
    }
    if (aumUsd === null) {
      missingAumStarted = true;
    } else {
      if (missingAumStarted) issues.push(`aum_after_missing_${expectedRank}`);
      if (aumUsd > previousAum) issues.push(`aum_order_${expectedRank}`);
      previousAum = aumUsd;
    }
  });

  const totalAssetsUsd = finiteNumber(data.total_assets_usd);
  if (totalAssetsUsd !== null && String(data.total_assets_usd_currency || "").toUpperCase() !== "USD") {
    issues.push("total_assets_usd_currency_missing");
  }

  if (!sourceRows.length) {
    if (total === 0 && returned === 0) {
      return { state: "empty", rows: [], issues, sourceTotal: sourceTotal ?? 0, activeCount: activeCount ?? 0, defunctCount: defunctCount ?? 0, total: 0 };
    }
    issues.push("empty_rows_with_nonzero_or_unknown_total");
  }

  return {
    state: issues.length ? "invalid" : "ready",
    rows: issues.length ? [] : sourceRows,
    issues,
    sourceTotal: sourceTotal ?? 0,
    activeCount: activeCount ?? 0,
    defunctCount: defunctCount ?? 0,
    total: total ?? 0,
  };
}

function emptyContract(state: AumRankingState): AumRankingContract {
  return { state, rows: [], issues: [], sourceTotal: 0, activeCount: 0, defunctCount: 0, total: 0 };
}

function isFactPacket(packet: Packet): boolean {
  return String(packet.status || "").toLowerCase() === "ok" && packet.fact === true;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function finiteInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function hasExplicitFxProvenance(row: Record<string, unknown>): boolean {
  const rate = finiteNumber(row.fx_rate || row.aum_fx_rate || row.usd_fx_rate);
  const date = String(row.fx_date || row.aum_fx_date || row.usd_fx_date || "").trim();
  const source = String(row.fx_source || row.aum_fx_source || row.usd_fx_source || "").trim();
  return rate !== null && rate > 0 && Boolean(date) && Boolean(source);
}
