export type NewsDateFilters = {
  dateFrom: string;
  dateTo: string;
};

export type NewsDateFilterValidation =
  | { ok: true; filters: NewsDateFilters; issue: "" }
  | { ok: false; filters: NewsDateFilters; issue: string };

export function emptyNewsDateFilters(): NewsDateFilters {
  return { dateFrom: "", dateTo: "" };
}

export function normalizeNewsDateFilters(input: NewsDateFilters): NewsDateFilterValidation {
  const filters = {
    dateFrom: input.dateFrom.trim(),
    dateTo: input.dateTo.trim(),
  };
  if (filters.dateFrom && !isIsoCalendarDate(filters.dateFrom)) {
    return { ok: false, filters, issue: "From must be a valid calendar date." };
  }
  if (filters.dateTo && !isIsoCalendarDate(filters.dateTo)) {
    return { ok: false, filters, issue: "To must be a valid calendar date." };
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return { ok: false, filters, issue: "From cannot be later than To." };
  }
  return { ok: true, filters, issue: "" };
}

export function newsSourceEndpoint(
  query: string,
  filters: NewsDateFilters,
  rowLimit: number,
  pageIndex: number,
): string {
  const params = new URLSearchParams({
    limit: String(rowLimit),
    page: String(pageIndex + 1),
  });
  const cleanQuery = query.trim();
  if (cleanQuery) params.set("q", cleanQuery);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return `/api/source-intelligence/news/v1?${params.toString()}`;
}

export function newsFilterSummary(query: string, filters: NewsDateFilters): string {
  const parts: string[] = [];
  if (query.trim()) parts.push(`query “${query.trim()}”`);
  if (filters.dateFrom && filters.dateTo) parts.push(`${filters.dateFrom} through ${filters.dateTo}`);
  else if (filters.dateFrom) parts.push(`on or after ${filters.dateFrom}`);
  else if (filters.dateTo) parts.push(`on or before ${filters.dateTo}`);
  return parts.length ? parts.join("; ") : "all dated news and articles";
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
