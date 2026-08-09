export type MandateFilters = {
  recordType: "all" | "rfp" | "opportunity";
  country: string;
  region: string;
  postedFrom: string;
  postedTo: string;
  dueFrom: string;
  dueTo: string;
  investmentTypes: string[];
  ticketMin: string;
  ticketMax: string;
  ticketCurrency: string;
};

export type MandateFilterValidation =
  | { ok: true; filters: MandateFilters; issue: "" }
  | { ok: false; filters: MandateFilters; issue: string };

export function emptyMandateFilters(): MandateFilters {
  return {
    recordType: "all",
    country: "",
    region: "",
    postedFrom: "",
    postedTo: "",
    dueFrom: "",
    dueTo: "",
    investmentTypes: [],
    ticketMin: "",
    ticketMax: "",
    ticketCurrency: "",
  };
}

export function normalizeMandateFilters(input: MandateFilters): MandateFilterValidation {
  const recordType = input.recordType === "rfp" || input.recordType === "opportunity" ? input.recordType : "all";
  const investmentTypes = [...new Set(input.investmentTypes.map((value) => value.trim()).filter(Boolean))];
  const ticketMin = normalizedPositiveInteger(input.ticketMin);
  const ticketMax = normalizedPositiveInteger(input.ticketMax);
  const ticketCurrency = input.ticketCurrency.trim().toUpperCase();
  const filters: MandateFilters = {
    recordType,
    country: input.country.trim(),
    region: input.region.trim(),
    postedFrom: input.postedFrom.trim(),
    postedTo: input.postedTo.trim(),
    dueFrom: input.dueFrom.trim(),
    dueTo: input.dueTo.trim(),
    investmentTypes,
    ticketMin: ticketMin.value,
    ticketMax: ticketMax.value,
    ticketCurrency,
  };

  for (const [label, value] of [
    ["Posted from", filters.postedFrom],
    ["Posted to", filters.postedTo],
    ["Due from", filters.dueFrom],
    ["Due to", filters.dueTo],
  ] as const) {
    if (value && !isIsoDate(value)) return { ok: false, filters, issue: `${label} must be a valid YYYY-MM-DD date.` };
  }
  if (filters.postedFrom && filters.postedTo && filters.postedFrom > filters.postedTo) {
    return { ok: false, filters, issue: "Posted from cannot be after posted to." };
  }
  if (filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo) {
    return { ok: false, filters, issue: "Due from cannot be after due to." };
  }

  if (!ticketMin.valid || !ticketMax.valid) {
    return { ok: false, filters, issue: "Ticket bounds must be positive whole numbers." };
  }
  if (ticketMin.value && ticketMax.value && Number(ticketMin.value) > Number(ticketMax.value)) {
    return { ok: false, filters, issue: "Minimum ticket cannot exceed maximum ticket." };
  }
  const hasTicketBound = Boolean(ticketMin.value || ticketMax.value);
  if (hasTicketBound && !ticketCurrency) {
    return { ok: false, filters, issue: "Choose a three-letter currency when applying a ticket bound." };
  }
  if (!hasTicketBound && ticketCurrency) {
    return { ok: false, filters, issue: "Set a ticket bound before applying a currency." };
  }
  if (ticketCurrency && !/^[A-Z]{3}$/.test(ticketCurrency)) {
    return { ok: false, filters, issue: "Currency must be a three-letter code such as USD." };
  }
  return { ok: true, filters, issue: "" };
}

export function mandateSourceEndpoint(filters: MandateFilters, rowLimit: number, pageIndex: number, query = ""): string {
  const params = new URLSearchParams({
    limit: String(rowLimit),
    page: String(pageIndex + 1),
    record_type: filters.recordType,
  });
  filters.investmentTypes.forEach((value) => {
    const clean = value.trim();
    if (clean) params.append("investment_type", clean);
  });
  if (filters.ticketMin) params.set("ticket_min", filters.ticketMin);
  if (filters.ticketMax) params.set("ticket_max", filters.ticketMax);
  if ((filters.ticketMin || filters.ticketMax) && filters.ticketCurrency) {
    params.set("ticket_currency", filters.ticketCurrency.trim().toUpperCase());
  }
  if (query.trim()) params.set("q", query.trim());
  if (filters.country) params.set("country", filters.country);
  if (filters.region) params.set("region", filters.region);
  if (filters.postedFrom) params.set("posted_from", filters.postedFrom);
  if (filters.postedTo) params.set("posted_to", filters.postedTo);
  if (filters.dueFrom) params.set("due_from", filters.dueFrom);
  if (filters.dueTo) params.set("due_to", filters.dueTo);
  return `/api/live-opportunities/v1?${params.toString()}`;
}

export function mandateFilterSummary(filters: MandateFilters): string {
  const parts: string[] = [];
  if (filters.recordType === "rfp") parts.push("RFP records only");
  if (filters.recordType === "opportunity") parts.push("Opportunity records only");
  if (filters.country) parts.push(`country ${filters.country}`);
  if (filters.region) parts.push(`region ${filters.region}`);
  if (filters.postedFrom || filters.postedTo) parts.push(`posted ${dateRange(filters.postedFrom, filters.postedTo)}`);
  if (filters.dueFrom || filters.dueTo) parts.push(`due ${dateRange(filters.dueFrom, filters.dueTo)}`);
  if (filters.investmentTypes.length) parts.push(`investment type ${filters.investmentTypes.join(" or ")}`);
  if (filters.ticketMin || filters.ticketMax) {
    const bounds = filters.ticketMin && filters.ticketMax
      ? `${filters.ticketMin}–${filters.ticketMax}`
      : filters.ticketMin
        ? `at least ${filters.ticketMin}`
        : `at most ${filters.ticketMax}`;
    parts.push(`${filters.ticketCurrency} ticket ${bounds}`);
  }
  return parts.length ? parts.join("; ") : "all currently open RFPs and Opportunities";
}

function dateRange(from: string, to: string): string {
  if (from && to) return `${from}–${to}`;
  return from ? `on or after ${from}` : `on or before ${to}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedPositiveInteger(value: string): { value: string; valid: boolean } {
  const clean = value.trim();
  if (!clean) return { value: "", valid: true };
  if (!/^\d+$/.test(clean)) return { value: clean, valid: false };
  const numeric = Number(clean);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? { value: String(numeric), valid: true }
    : { value: clean, valid: false };
}
