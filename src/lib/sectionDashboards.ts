// Pure ranking/freshness/focus logic for the Dashboard 2.0 section panels.
// No React, no DOM, and `now` is always injected — so
// scripts/swfipn-section-dashboard-logic-test.mjs runs this exact code under
// node with fixture rows and a pinned clock.

export type DashRecord = {
  label: string;
  category: string;
  geography: string;
  sizeDisplay: string;
  sizeValue: number | null;
  dateStamp: number;
  createdStamp: number;
  updatedStamp: number;
  deadlineStamp: number;
};

const DAY_MS = 86_400_000;

export function parseStamp(raw: unknown): number {
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function firstStamp(values: unknown[]): number {
  for (const value of values) {
    const stamp = parseStamp(value);
    if (stamp) return stamp;
  }
  return 0;
}

export function largestRanking<T extends DashRecord>(records: T[], minEntries = 3, top = 5): T[] {
  const ranked = records
    .filter((record) => (record.sizeValue ?? 0) > 0)
    .sort((a, b) => (b.sizeValue ?? 0) - (a.sizeValue ?? 0))
    .slice(0, top);
  return ranked.length >= minEntries ? ranked : [];
}

export function mostRecentRanking<T extends DashRecord>(records: T[], minEntries = 3, top = 5): T[] {
  const ranked = records
    .filter((record) => record.dateStamp > 0)
    .sort((a, b) => b.dateStamp - a.dateStamp)
    .slice(0, top);
  return ranked.length >= minEntries ? ranked : [];
}

export function closingSoonestRanking<T extends DashRecord>(records: T[], now: number, minEntries = 3, top = 5): T[] {
  const ranked = records
    .filter((record) => record.deadlineStamp > now)
    .sort((a, b) => a.deadlineStamp - b.deadlineStamp)
    .slice(0, top);
  return ranked.length >= minEntries ? ranked : [];
}

export function focusRanking<T extends DashRecord>(records: T[], focusTerms: string[], top = 5): T[] {
  const terms = focusTerms.map((term) => term.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return [];
  return records
    .filter((record) => terms.includes(record.category.trim().toLowerCase()) || terms.includes(record.geography.trim().toLowerCase()))
    .sort((a, b) => ((b.sizeValue ?? 0) - (a.sizeValue ?? 0)) || (b.dateStamp - a.dateStamp))
    .slice(0, top);
}

export type FreshnessEntry<T> = { record: T; changeKind: "new" | "updated"; stamp: number };
export type FreshnessSummary<T> = { windowDays: number; entries: FreshnessEntry<T>[]; newCount: number; updatedCount: number };

// 7-day window first; when it holds fewer than 2 dated changes, widen once to
// 30 days; below 2 there is no strip (no empty frames). Future-dated stamps
// (bad source data) never count as fresh.
export function freshnessSummary<T extends DashRecord>(records: T[], now: number, top = 5): FreshnessSummary<T> | null {
  for (const windowDays of [7, 30]) {
    const cutoff = now - windowDays * DAY_MS;
    const entries: FreshnessEntry<T>[] = [];
    records.forEach((record) => {
      const isNew = record.createdStamp >= cutoff && record.createdStamp <= now;
      const isUpdated = !isNew && record.updatedStamp >= cutoff && record.updatedStamp <= now;
      if (isNew) entries.push({ record, changeKind: "new", stamp: record.createdStamp });
      else if (isUpdated) entries.push({ record, changeKind: "updated", stamp: record.updatedStamp });
    });
    entries.sort((a, b) => b.stamp - a.stamp);
    if (entries.length >= 2) {
      return {
        windowDays,
        entries: entries.slice(0, top),
        newCount: entries.filter((entry) => entry.changeKind === "new").length,
        updatedCount: entries.filter((entry) => entry.changeKind === "updated").length,
      };
    }
  }
  return null;
}

export function daysUntilLabel(deadlineStamp: number, now: number): string {
  const days = Math.ceil((deadlineStamp - now) / DAY_MS);
  if (days <= 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `Closes in ${days} days`;
}
