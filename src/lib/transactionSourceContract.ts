export const TRANSACTION_FILTER_OPTIONS = [
  ["name", "Transaction name"],
  ["buyer_entity", "Buyer entity"],
  ["seller_entity", "Seller entity"],
  ["type", "Transaction type"],
  ["investment_type", "Acquisition / investment type"],
  ["sector", "Sector"],
  ["industry", "Industry"],
] as const;

export type TransactionFilterField = (typeof TRANSACTION_FILTER_OPTIONS)[number][0];

export type TransactionFilter = {
  field: TransactionFilterField | "";
  value: string;
  days: 30 | 90 | 180 | 365;
};

const TRANSACTION_FILTER_FIELDS = new Set<string>(TRANSACTION_FILTER_OPTIONS.map(([value]) => value));
const TRANSACTION_WINDOWS = new Set<number>([30, 90, 180, 365]);

export function emptyTransactionFilter(): TransactionFilter {
  return { field: "", value: "", days: 365 };
}

export function isTransactionFilterField(value: string): value is TransactionFilterField {
  return TRANSACTION_FILTER_FIELDS.has(value);
}

export function normalizedTransactionWindow(value: number): TransactionFilter["days"] {
  return TRANSACTION_WINDOWS.has(value) ? value as TransactionFilter["days"] : 365;
}

export function transactionSourceEndpoint(
  filter: TransactionFilter,
  rowLimit: number,
  pageIndex: number,
): string {
  const params = new URLSearchParams({
    days: String(normalizedTransactionWindow(filter.days)),
    limit: String(rowLimit),
    page: String(pageIndex + 1),
  });
  const value = filter.value.trim();
  if (filter.field && value) {
    params.set("field", filter.field);
    params.set("value", value);
    return `/api/transaction-drilldown/v1?${params.toString()}`;
  }
  return `/api/recent-transactions/v1?${params.toString()}`;
}

export function transactionFilterLabel(filter: TransactionFilter): string {
  if (!filter.field || !filter.value.trim()) return "Recent transactions";
  return TRANSACTION_FILTER_OPTIONS.find(([value]) => value === filter.field)?.[1] || "Exact transaction filter";
}
