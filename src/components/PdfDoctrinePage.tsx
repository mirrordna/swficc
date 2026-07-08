"use client";

import { useEffect, useMemo, useState } from "react";
import { useGsapReveal } from "@/hooks/useGsapReveal";
import type { Packet, Row } from "@/lib/sourcePackets";
import { DASHBOARD_SECTION_NAV } from "@/lib/dashboardSectionNav";
import {
  fetchPacket,
  isFact,
  money,
  normalizeSwfiUrl,
  numericSortValue,
  packetData,
  rows,
  sourceRows,
  text,
} from "@/lib/sourcePackets";
import { appHref } from "@/lib/selfContainedLinks";
import { mandateDetailHref, profileDetailHref, researchDetailHref, transactionDetailHref } from "@/lib/detailRoutes";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";

type Packets = Record<string, Packet>;
type TableCell = string | { label: string; href: string };

const pageLinks = DASHBOARD_SECTION_NAV;

const ENDPOINTS = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  top20: "/v1/swfi/top20?limit=100",
  allocators: "/api/active-allocators/v1?days=90&limit=100&sort=activity_count&direction=desc",
  rfps: "/api/live-opportunities/v1?limit=100&page=1",
  transactions: "/api/recent-transactions/v1?days=90&limit=100&page=1",
  sectorFlows: "/api/sector-flows/v1?days=365",
  news: "/api/source-intelligence/news/v1?limit=100",
  reports: "/api/reports/v1?limit=100&page=1",
};

export default function PdfDoctrinePage() {
  const rootRef = useGsapReveal<HTMLDivElement>();
  const [packets, setPackets] = useState<Packets>({});
  // Default to the visual view (Paul's law 2026-07-06: "every page should
  // have a visual graph"; the audit found this page's existing visualization
  // hidden behind the Data default — same trap as the filtered-mandates bug).
  const [view, setView] = useState<"data" | "visualization">("visualization");

  useEffect(() => {
    let active = true;
    async function load() {
      const loaded = await Promise.all(
        Object.entries(ENDPOINTS).map(async ([key, path]) => [key, await fetchPacket(path, 30_000)] as const),
      );
      if (!active) return;
      setPackets(Object.fromEntries(loaded));
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const topAumRows = sourceRows(packets.top20)
    .map((row) => ({
      row,
      cells: [
        linkedName(row, "entity"),
        clean(row.type || row.entity_type),
        clean(row.country || row.region),
        cleanMoney(row.aum || row.assets),
      ] as TableCell[],
    }))
    .filter((item) => displayText(item.cells[0]) && item.cells[3])
    .map((item) => item.cells);

  const allocatorRows = rows(packets.allocators)
    .map((row) => [
      linkedName(row, "entity"),
      clean(row.entity_type || row.type),
      clean(row.country),
      clean(row.region),
      clean(row.activity_reason),
      clean(row.activity_count),
      cleanDate(row.most_recent_activity_date || row.last_updated),
      cleanMoney(row.assets || row.aum),
      cleanMoney(row.managed_assets || row.assets_managed),
    ] as TableCell[])
    .filter((row) => displayText(row[0]) && displayText(row[5]));

  const mandateRows = rows(packets.rfps)
    .map((row) => [
      linkedName(row, "compass"),
      clean(row.institution || row.entity || row.owner || row.organization),
      clean(row.asset_class || row.category || row.type),
      cleanDate(row.deadline || row.due_date || row.closed_at || row.date),
    ] as TableCell[])
    .filter((row) => displayText(row[0]));

  const transactionRows = rows(packets.transactions)
    .map((row) => [
      linkedName(row, "transaction"),
      clean(row.buyer_entity || row.buyer || row.institution),
      clean(row.seller_entity || row.seller),
      cleanMoney(row.amount_display || row.amount_usd || row.amount),
      cleanDate(row.closed_at || row.closedAt || row.date),
    ] as TableCell[])
    .filter((row) => displayText(row[0]));

  const marketRows = rows(packets.sectorFlows, "rows")
    .map((row) => [
      clean(row.name || row.sector || row.industry),
      cleanMoney(row.capital_display || row.capital_deployed || row.capital),
      clean(row.count ? `${row.count} transactions` : ""),
    ] as TableCell[])
    .filter((row) => displayText(row[0]) && displayText(row[1]));

  const newsRows = rows(packets.news)
    .map((row) => [
      linkedName(row, "news"),
      cleanDate(row.published_at || row.publishedAt || row.updated_at || row.date),
    ] as TableCell[])
    .filter((row) => displayText(row[0]));

  const reportRows = rows(packets.reports)
    .map((row) => [
      linkedName(row, "report"),
      clean(row.type),
      cleanDate(row.published_at || row.publishedAt),
      clean(row.report_url || row.source_url) ? "Report asset on file" : "",
    ] as TableCell[])
    .filter((row) => displayText(row[0]));

  const summaryRows: TableCell[][] = [
    ["Institutions", metricValue(packets.metrics, "institutions") || topAumRows.length.toLocaleString("en-US"), "SWFI records"],
    ["Active allocators", metricValue(packets.metrics, "allocators") || allocatorRows.length.toLocaleString("en-US"), "SWFI allocator records"],
    ["Live RFPs / mandates", countDisplay(packets.rfps) || mandateRows.length.toLocaleString("en-US"), "SWFI Compass records"],
    ["Recent transactions", countDisplay(packets.transactions) || transactionRows.length.toLocaleString("en-US"), "SWFI transaction records"],
  ];

  return (
    <div ref={rootRef} className="flex min-h-screen flex-col bg-[#F2F4F6] font-sans text-[#1B2733] lg:h-screen lg:overflow-hidden">
      <SwfiBrandHeader searchId="reports-global-search" />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside data-gsap-reveal className="flex w-full shrink-0 flex-wrap overflow-visible bg-[#11314F] lg:block lg:w-[196px] lg:overflow-y-auto">
          {pageLinks.map(([label, href]) => (
            <a
              key={label}
              href={appHref(href)}
              className={`flex min-h-9 flex-1 basis-[132px] items-center border-l-[3px] px-3.5 text-[13.5px] no-underline lg:flex-none ${href === "/reports" ? "border-[#5C9BD6] bg-white/10 text-white" : "border-transparent text-[#A7BCD0]"}`}
            >
              {label}
            </a>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-visible lg:overflow-y-auto">
          <div className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]">
            <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Reports</h1>
                  <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Rankings, allocator activity, transactions, mandates, and market-flow tables; sign in on SWFI to export them. For the live news feed, see Research &amp; Analytics.</p>
                </div>
                <a href="/swficc/" className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">Dashboard</a>
              </div>
            </section>

            <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#41566B]">
              <strong className="text-[#11314F]">Updated from SWFI.</strong> Each linked row opens the corresponding SWFI record.
            </section>

            <section
              data-gsap-reveal
              className="rounded border border-[#DCE3EA] bg-white px-4 py-3"
              data-display-id="reports-visualization"
              data-display-type="chart"
              data-purpose="Distribution of SWFI report assets by category, with market, allocator, and transaction context tables."
              data-source="SWFI report asset records on file"
              data-primary-cta="Sign in on SWFI to export"
              data-cta-href="https://www.swfi.com/v1/signin/?msg=auth"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Reports / League Tables Visualization</h2>
                  <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Reports, rankings, allocator activity, transactions, and market-flow visuals.</p>
                </div>
                <div className="flex rounded border border-[#C7D2DD] bg-[#F7F9FA] p-1 text-sm">
                  {[
                    ["data", "Data"],
                    ["visualization", "Visualization"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setView(value as "data" | "visualization")}
                      className={`rounded px-3 py-1.5 font-semibold ${view === value ? "bg-white text-[#11314F] shadow-sm" : "text-[#617386]"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {view === "visualization" ? (
                <ReportsVisualization
                  reportRows={reportRows}
                  marketRows={marketRows}
                  allocatorRows={allocatorRows}
                  transactionRows={transactionRows}
                />
              ) : null}
            </section>

            <Section title="AUM Rankings">
              <ReportTable
                filename="swfi-aum-rankings.csv"
                headers={["Institution", "Type", "Country / Region", "AUM"]}
                rows={topAumRows}
                empty="No AUM ranking rows available."
              />
            </Section>

            <Section title="Dashboard Summary">
              <ReportTable
                filename="swfi-dashboard-summary.csv"
                headers={["Metric", "Value", "Basis"]}
                rows={summaryRows}
                empty="No summary rows available."
              />
            </Section>

            <Section title="Active Allocators">
              <ReportTable
                filename="swfi-active-allocators.csv"
                headers={["Entity Name", "Entity Type", "Country", "Region", "Activity Reason", "Activity Count", "Most Recent Activity Date", "AUM", "Managed Assets"]}
                rows={allocatorRows}
                empty="No active allocator rows available."
              />
            </Section>

            <Section title="RFP Opportunities">
              <ReportTable
                filename="swfi-rfp-opportunities.csv"
                headers={["Mandate", "Institution", "Category", "Deadline"]}
                rows={mandateRows}
                empty="No live RFP rows available."
              />
            </Section>

            <Section title="Recent Transactions">
              <ReportTable
                filename="swfi-recent-transactions.csv"
                headers={["Deal", "Buyer Entity", "Seller Entity", "Amount", "Closed At"]}
                rows={transactionRows}
                empty="No recent transaction rows available."
              />
            </Section>

            <Section title="Market Activity">
              <ReportTable
                filename="swfi-market-activity.csv"
                headers={["Sector / Industry", "Capital Deployed", "Record Count"]}
                rows={marketRows}
                empty="No market activity rows available."
              />
            </Section>

            <Section title="Quarterly Reports">
              <ReportTable
                filename="swfi-quarterly-reports.csv"
                headers={["Report", "Type", "Published At", "Asset"]}
                rows={reportRows}
                empty="No report rows available."
              />
            </Section>

            <Section title="News">
              <ReportTable
                filename="swfi-news.csv"
                headers={["Article", "Published / Updated"]}
                rows={newsRows}
                empty="No news rows available."
              />
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={slugify(title)} data-gsap-reveal className="scroll-mt-16 grid gap-3 rounded border border-[#DCE3EA] bg-white p-4">
      <h2 className="m-0 text-[20px] font-bold text-[#11314F]">{title}</h2>
      {children}
    </section>
  );
}

function ReportsVisualization({ reportRows, marketRows, allocatorRows, transactionRows }: { reportRows: TableCell[][]; marketRows: TableCell[][]; allocatorRows: TableCell[][]; transactionRows: TableCell[][] }) {
  const reportBuckets = bucketTableRows(reportRows, 1);
  const marketBuckets = marketRows.slice(0, 8).map((row) => ({ label: displayText(row[0]), count: numericSortValue(displayText(row[2])) || 1 }));
  const summary = [
    ["Reports", reportRows.length.toLocaleString("en-US")],
    ["League Tables", reportRows.filter((row) => /league/i.test(displayText(row[0]))).length.toLocaleString("en-US")],
    ["Recent Transactions", transactionRows.length.toLocaleString("en-US")],
    ["Active Allocators", allocatorRows.length.toLocaleString("en-US")],
  ] as const;
  return (
    <div className="grid gap-4" data-brd-reports-visualization="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1 text-[12px] text-[#7A8A9B]">
          <span>Updated from SWFI</span>
          <span>League Tables and reports are represented from the report asset records on file.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Dashboard 2.0 P05: data export requires SWFI authentication — no public downloads. */}
          <a href="https://www.swfi.com/v1/signin/?msg=auth" className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C] no-underline">Sign in on SWFI to export</a>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{label}</div>
            <div className="mt-1 text-[18px] font-bold text-[#11314F]">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportsBarChart title="Reports by Type" rows={reportBuckets} />
        <ReportsBarChart title="Market Activity by Sector" rows={marketBuckets} />
      </div>
    </div>
  );
}

function ReportsBarChart({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      <div className="grid gap-2">
        {rows.length ? rows.slice(0, 8).map((row) => (
          <a key={`${title}-${row.label}`} href={appHref(`/reports/?filter=${encodeURIComponent(row.label)}`)} className="grid gap-1 text-inherit no-underline">
            <div className="flex justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
              <span className="font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
            </div>
            <div className="h-2 rounded bg-[#E8EDF2]">
              <div className="h-2 rounded bg-[#5C9BD6]" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
            </div>
          </a>
        )) : <div className="text-sm text-[#7A8A9B]">No source rows available.</div>}
      </div>
    </div>
  );
}

function ReportTable({ headers, rows: tableRows, filename, empty }: { headers: string[]; rows: TableCell[][]; filename: string; empty: string }) {
  const [filter, setFilter] = useState("");
  const [sortColumn, setSortColumn] = useState(0);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [rowLimit, setRowLimit] = useState(5);
  const [pageIndex, setPageIndex] = useState(0);

  const sourceRows = tableRows.filter((row) => row.some((cell) => displayText(cell)));
  const sortedRows = useMemo(() => {
    const cleanFilter = filter.trim().toLowerCase();
    const filtered = cleanFilter
      ? sourceRows.filter((row) => row.some((cell) => displayText(cell).toLowerCase().includes(cleanFilter)))
      : sourceRows;
    return [...filtered].sort((a, b) => compareValues(displayText(a[sortColumn]), displayText(b[sortColumn]), sortDir));
  }, [filter, sortColumn, sortDir, sourceRows]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / rowLimit));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePageIndex * rowLimit;
  const visibleRows = sortedRows.slice(pageStart, pageStart + rowLimit);
  const showRowLimit = sourceRows.length > 5;

  if (!sourceRows.length) {
    return <div className="rounded border border-[#DCE3EA] px-3 py-2 text-sm text-[#41566B]">{empty}</div>;
  }

  return (
    <div className="grid gap-2">
      <div className={`grid gap-2 rounded border border-[#DCE3EA] bg-white px-3 py-2 text-sm sm:items-center ${showRowLimit ? "sm:grid-cols-[minmax(0,1fr)_180px_130px_auto]" : "sm:grid-cols-[minmax(0,1fr)_180px_auto]"}`}>
        <div className="font-semibold text-[#11314F]">
          Showing {visibleRows.length.toLocaleString("en-US")} of {sourceRows.length.toLocaleString("en-US")}
          {sortedRows.length !== sourceRows.length ? ` / filtered ${sortedRows.length.toLocaleString("en-US")}` : ""}
        </div>
        <label className="grid gap-1">
          <span className="font-semibold text-[#41566B]">Filter</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPageIndex(0);
            }}
            className="min-h-8 rounded border border-[#C7D2DD] px-2 outline-none"
            placeholder="Filter rows"
          />
        </label>
        {showRowLimit ? (
          <label className="grid gap-1">
            <span className="font-semibold text-[#41566B]">Rows</span>
            <select
              value={rowLimit}
              onChange={(event) => {
                setRowLimit(Number(event.target.value));
                setPageIndex(0);
              }}
              className="min-h-8 rounded border border-[#C7D2DD] bg-white px-2"
            >
              {[5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : null}
        {/* Dashboard 2.0 P05: data export requires SWFI authentication — no public downloads. */}
        <a href="https://www.swfi.com/v1/signin/?msg=auth" className="grid min-h-8 place-items-center rounded border border-[#C7D2DD] bg-white px-3 text-[#16538C] no-underline">
          Sign in on SWFI to export
        </a>
      </div>
      <div className="grid gap-3 sm:hidden">
        {visibleRows.map((row, rowIndex) => (
          <div key={rowIndex} className="rounded border border-[#DCE3EA] bg-white">
            {headers.map((header, colIndex) => (
              <div key={header} className="grid grid-cols-[112px_minmax(0,1fr)] border-b border-[#E8EDF2] last:border-b-0">
                <div className="border-r border-[#E8EDF2] px-2 py-1 text-sm font-semibold text-[#11314F]">{header}</div>
                <div className="min-w-0 break-words px-2 py-1 text-sm text-[#41566B]">{displayCell(row[colIndex])}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded border border-[#DCE3EA] bg-white sm:block">
        <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
          <thead>
            <tr className="bg-[#F7F9FA]">
              {headers.map((header, index) => (
                <th key={header} className="border-b border-[#DCE3EA] px-3 py-2 font-semibold text-[#41566B]">
                  {sourceRows.length > 1 ? (
                    <button
                      type="button"
                      className="w-full bg-transparent text-left font-semibold"
                      onClick={() => {
                        setSortColumn(index);
                        setSortDir(sortColumn === index && sortDir === "asc" ? "desc" : "asc");
                        setPageIndex(0);
                      }}
                    >
                      {header}{sortColumn === index ? ` ${sortDir}` : ""}
                    </button>
                  ) : header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[#F2F5F8] last:border-b-0">
                {headers.map((header, colIndex) => <td key={header} className="px-3 py-2 align-top text-[#41566B]">{displayCell(row[colIndex])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#DCE3EA] bg-white px-3 py-2 text-sm text-[#41566B]">
          <div>Page {(safePageIndex + 1).toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-[#C7D2DD] bg-white px-3 py-1 text-[#16538C] disabled:opacity-40"
              disabled={safePageIndex <= 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border border-[#C7D2DD] bg-white px-3 py-1 text-[#16538C] disabled:opacity-40"
              disabled={safePageIndex >= pageCount - 1}
              onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function displayText(value?: TableCell): string {
  if (typeof value === "object" && value) return value.label;
  return value || "";
}

function displayCell(value?: TableCell) {
  if (!value) return "";
  if (typeof value === "object") {
    return <a href={recordOrAppHref(value.href)} data-record-link="true" className="text-[#16538C] underline">{value.label}</a>;
  }
  return value;
}

function recordOrAppHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : appHref(href);
}

function clean(value: unknown): string {
  const valueText = text(value, "").trim();
  if (!valueText || /not disclosed|unavailable|undefined|null/i.test(valueText)) return "";
  return valueText;
}

function cleanMoney(value: unknown): string {
  const valueText = money(value);
  if (!valueText || /not disclosed|unavailable|undefined|null/i.test(valueText)) return "";
  return valueText;
}

function cleanDate(value: unknown): string {
  const valueText = clean(value);
  if (!valueText) return "";
  return valueText.slice(0, 10);
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function metricValue(packet: Packet | undefined, key: string): string {
  if (!isFact(packet)) return "";
  const cards = record(packetData(packet).cards);
  const value = record(cards[key]).value;
  return typeof value === "number" ? value.toLocaleString("en-US") : clean(value);
}

function countDisplay(packet: Packet | undefined): string {
  if (!isFact(packet)) return "";
  const value = packetData(packet).count;
  return typeof value === "number" ? value.toLocaleString("en-US") : clean(value);
}

function linkedName(row: Row, kind: "entity" | "transaction" | "compass" | "news" | "report"): TableCell {
  const label = clean(row.name || row.title || row.entity_name || row.institution || row.buyer_entity || row.article_title);
  const href = rowSourceHref(row, kind);
  return label && href ? { label, href } : label;
}

function rowSourceHref(row: Row, kind: "entity" | "transaction" | "compass" | "news" | "report"): string {
  let provenance = "";
  for (const key of ["source_url", "swfi_url", "profile_url", "url", "institution_url", "buyer_entity_url", "report_url", "download_url", "file_url", "asset_url"]) {
    const value = clean(row[key]);
    if (!value.startsWith("http://") && !value.startsWith("https://")) continue;
    provenance = normalizeSwfiUrl(value);
    break;
  }
  if (kind === "news") {
    const legacy = clean(row.legacy_id || row.legacy_post || row.post_id || row.wordpress_id || row.id);
    return researchDetailHref(row, provenance || (/^\d+$/.test(legacy) ? `https://www.swfi.com/?p=${encodeURIComponent(legacy)}` : undefined));
  }
  if (kind === "entity") return profileDetailHref(row, provenance || undefined);
  if (kind === "transaction") return transactionDetailHref(row, provenance || undefined);
  if (kind === "report") {
    return provenance;
  }
  return mandateDetailHref(row, provenance || undefined);
}

function compareValues(a: string, b: string, dir: "asc" | "desc") {
  const an = numericSortValue(a);
  const bn = numericSortValue(b);
  if (an !== null && bn === null) return dir === "asc" ? -1 : 1;
  if (an === null && bn !== null) return dir === "asc" ? 1 : -1;
  const result = an !== null && bn !== null
    ? an - bn
    : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

function bucketTableRows(tableRows: TableCell[][], columnIndex: number) {
  const buckets = new Map<string, number>();
  tableRows.forEach((row) => {
    const label = displayText(row[columnIndex]) || "Not disclosed";
    buckets.set(label, (buckets.get(label) || 0) + 1);
  });
  return [...buckets.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
