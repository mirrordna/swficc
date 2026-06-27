"use client";

import type { BusinessModelItem } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function BusinessModels({ models }: { models: BusinessModelItem[] }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Top-Funded Business Models Dashboard</h3>
      </div>
      <div className="mb-3 text-sm text-gray-700">
        AI, Infrastructure, Private Credit, Real Estate, Emerging sectors
      </div>
      <div className="grid gap-2">
        {!models.length && <SourceGap message="Business-model deployment requires approved SWFI transaction rows. No illustrative capital totals are shown." />}
        {models.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Sector", "Capital Deployed", "Growth %", "Active Investors"].map((h) => (
                  <th key={h} className="border border-gray-300 px-2 py-1.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.slice(0, 6).map((m) => {
                const provenance = sourceProvenanceHref(m.href);
                return (
                <tr key={m.sector}>
                  <td className="border border-gray-300 px-2 py-1.5">
                    <a
                      href={selfContainedHref(m.href, "/transactions/")}
                      data-source-state={provenance ? "on-file" : undefined}
                      title={provenance ? "Source on file" : undefined}
                      className="text-black no-underline hover:underline"
                    >
                      {m.sector}
                    </a>
                  </td>
                  <td className="border border-gray-300 px-2 py-1.5">{m.capital_deployed}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{m.growth}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{m.active_investors_display || "Not disclosed"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}
