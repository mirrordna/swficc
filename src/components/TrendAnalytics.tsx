"use client";

import type { TrendItem } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function TrendAnalytics({ trends }: { trends: TrendItem[] }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Investment Trend Analytics</h3>
      </div>
      {!trends.length && <SourceGap message="Investment trends require approved SWFI capital-flow rows. No PDF example growth rates are shown." />}
      {trends.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Sector", "Capital Deployed", "Growth", "Active Investors"].map((h) => (
                  <th key={h} className="border border-gray-300 px-2 py-1.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trends.slice(0, 6).map((t) => {
                const provenance = sourceProvenanceHref(t.href);
                return (
                <tr key={t.sector}>
                  <td className="border border-gray-300 px-2 py-1.5">
                    <a
                      href={selfContainedHref(t.href, "/transactions/")}
                      data-source-state={provenance ? "on-file" : undefined}
                      title={provenance ? "Source on file" : undefined}
                      className="text-black no-underline hover:underline"
                    >
                      {t.sector}
                    </a>
                  </td>
                  <td className="border border-gray-300 px-2 py-1.5">{t.capital_deployed}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{t.growth}</td>
                  <td className="border border-gray-300 px-2 py-1.5">{t.active_investors_display || "Not disclosed"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
