"use client";

import type { CoInvestmentTracking } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function CoInvestment({ data }: { data: CoInvestmentTracking }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Co-Investment Tracking</h3>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {data.filters.map((f) => (
          <span key={f} className="border border-gray-300 px-3 py-1 text-xs text-gray-700">{f}</span>
        ))}
      </div>

      <div className="flex gap-3 mb-3">
        {data.kpis.map((k) => {
          const provenance = sourceProvenanceHref(k.href);
          return (
          <a
            key={k.label}
            href={selfContainedHref(k.href, "/transactions/")}
            data-source-state={provenance ? "on-file" : undefined}
            title={provenance ? "Source on file" : undefined}
            className="flex min-w-[120px] flex-col gap-1 border border-gray-300 px-3 py-2 no-underline text-inherit"
          >
            <span className="text-gray-500 text-xs uppercase">{k.label}</span>
            <strong className="text-base text-black">{k.value}</strong>
          </a>
          );
        })}
      </div>

      {data.network && (
        <a
          href={selfContainedHref(data.network.href, "/search/")}
          data-source-state={sourceProvenanceHref(data.network.href) ? "on-file" : undefined}
          title={sourceProvenanceHref(data.network.href) ? "Source on file" : undefined}
          className="block border border-gray-300 p-3 no-underline text-inherit mb-3"
        >
          <strong className="block text-gray-900 mb-1">{data.network.title}</strong>
          <p className="m-0 text-gray-600 text-sm">{data.network.nodes}</p>
          <p className="m-0 text-gray-600 text-sm">{data.network.links}</p>
        </a>
      )}

      <div className="overflow-x-auto">
        {!data.rows.length && <SourceGap message="Co-investment rows require approved SWFI transaction-pair data. No inferred network is shown." />}
        {data.rows.length > 0 && (
          <>
            <div className="grid bg-gray-50" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 1fr 0.8fr" }}>
              {["Investor A", "Investor B", "Sector", "Deal", "Amount"].map((h) => (
                <span key={h} className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">{h}</span>
              ))}
            </div>
            {data.rows.slice(0, 5).map((row, i) => {
              const provenance = sourceProvenanceHref(row.href);
              return (
              <a
                key={i}
                href={selfContainedHref(row.href, "/transactions/")}
                data-source-state={provenance ? "on-file" : undefined}
                title={provenance ? "Source on file" : undefined}
                className="grid no-underline text-inherit hover:bg-gray-50"
                style={{ gridTemplateColumns: "1fr 1fr 0.8fr 1fr 0.8fr" }}
              >
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.investor_a}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.investor_b}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.sector}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.deal}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.amount}</span>
              </a>
              );
            })}
          </>
        )}
      </div>
    </article>
  );
}
