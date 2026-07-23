export type MandateFilters = {
  investmentTypes: string[];
  ticketMin: string;
  ticketMax: string;
  ticketCurrency: string;
};

export type MandateFilterValidation =
  | { ok: true; filters: MandateFilters; issue: "" }
  | { ok: false; filters: MandateFilters; issue: string };

export function emptyMandateFilters(): MandateFilters {
  return { investmentTypes: [], ticketMin: "", ticketMax: "", ticketCurrency: "" };
}

export function normalizeMandateFilters(input: MandateFilters): MandateFilterValidation {
  const investmentTypes = [...new Set(input.investmentTypes.map((value) => value.trim()).filter(Boolean))];
  const ticketMin = normalizedPositiveInteger(input.ticketMin);
  const ticketMax = normalizedPositiveInteger(input.ticketMax);
  const ticketCurrency = input.ticketCurrency.trim().toUpperCase();
  const filters = {
    investmentTypes,
    ticketMin: ticketMin.value,
    ticketMax: ticketMax.value,
    ticketCurrency,
  };

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

export function mandateSourceEndpoint(filters: MandateFilters, rowLimit: number, pageIndex: number): string {
  const params = new URLSearchParams({
    limit: String(rowLimit),
    page: String(pageIndex + 1),
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
  return `/api/live-opportunities/v1?${params.toString()}`;
}

export function mandateFilterSummary(filters: MandateFilters): string {
  const parts: string[] = [];
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

function normalizedPositiveInteger(value: string): { value: string; valid: boolean } {
  const clean = value.trim();
  if (!clean) return { value: "", valid: true };
  if (!/^\d+$/.test(clean)) return { value: clean, valid: false };
  const numeric = Number(clean);
  return Number.isSafeInteger(numeric) && numeric > 0
    ? { value: String(numeric), valid: true }
    : { value: clean, valid: false };
}
