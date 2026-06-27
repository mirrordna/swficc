"use client";

import { useState } from "react";
import type { QuickInsight, InsightItem } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

const TABS = [
  { key: "top-investors", label: "Top Investors (Last 30 Days)" },
  { key: "fundraising", label: "Fundraising" },
  { key: "market-activity", label: "Market Activity" },
  { key: "news", label: "News" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
type InsightItemWithSource = InsightItem & { source_url?: string };

function mapInsights(insights: QuickInsight[]): Record<TabKey, QuickInsight | null> {
  const result: Record<TabKey, QuickInsight | null> = {
    "top-investors": null,
    fundraising: null,
    "market-activity": null,
    news: null,
  };
  insights.forEach((insight, i) => {
    const title = (insight.title || "").toLowerCase();
    if (title.includes("active") || title.includes("investor") || i === 0) result["top-investors"] = insight;
    else if (title.includes("fundrais") || i === 1) result.fundraising = insight;
    else if (title.includes("market") || i === 2) result["market-activity"] = insight;
    else if (title.includes("news") || title.includes("intelligence") || i === 2) result.news = insight;
  });
  return result;
}

export default function InsightsPanel({ insights }: { insights: QuickInsight[] }) {
  const [activeTab, setActiveTab] = useState<TabKey>("top-investors");
  const mapped = mapInsights(insights);

  return (
    <section className="border border-gray-300 bg-white">
      <h2 className="m-0 border-b border-gray-300 px-3 py-2 text-base font-semibold">INSIGHTS</h2>

      <div className="flex flex-wrap border-b border-gray-300" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`border-0 border-r border-gray-300 px-3 py-2 text-sm cursor-pointer ${
              activeTab === tab.key
                ? "bg-gray-100 text-black font-semibold"
                : "bg-white text-black hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-3 min-h-[120px]">
        <TabContent tabKey={activeTab} insight={mapped[activeTab]} />
      </div>
    </section>
  );
}

function TabContent({ tabKey, insight }: { tabKey: TabKey; insight: QuickInsight | null }) {
  const items = insight?.items || [];
  const insightProvenance = sourceProvenanceHref(insight?.href);

  if (tabKey === "top-investors") {
    return (
      <>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Institution", "Deals", "Sector", "Region"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-gray-500 text-[0.68rem] font-bold font-mono uppercase tracking-wider border-b border-gray-200">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 8).map((item, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2.5 text-sm border-b border-gray-100">
                  {item.profile_url ? (() => {
                    const provenance = sourceProvenanceHref(item.profile_url);
                    return (
                  <a
                    href={selfContainedHref(item.profile_url, "/profiles/")}
                    data-source-state={provenance ? "on-file" : undefined}
                    title={provenance ? "Source on file" : undefined}
                    className="text-black font-semibold no-underline hover:underline"
                  >
                      {item.name || item.title || "Institution"}
                    </a>
                    );
                  })() : (
                    <span className="font-semibold">{item.name || item.title || "Institution"}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.metric || item.aum || "Not disclosed"}</td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.strategy || item.sector || item.note || "Not disclosed"}</td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.country || item.region || "Not disclosed"}</td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={4} className="py-3"><SourceGap message="Top active investor rows require approved SWFI allocator-activity records." /></td></tr>
            )}
          </tbody>
        </table>
        {insight?.href && (
          <div className="mt-2.5">
            <a
              href={selfContainedHref(insight.href, "/profiles/")}
              data-source-state={insightProvenance ? "on-file" : undefined}
              title={insightProvenance ? "Source on file" : undefined}
              className="text-black text-sm font-semibold no-underline hover:underline"
            >
              View all active investors
            </a>
          </div>
        )}
      </>
    );
  }

  // Card layout for other tabs
  return (
    <>
      <div className="grid gap-2.5">
        {items.slice(0, 6).map((item, i) => (
          <ItemCard key={i} item={item} />
        ))}
        {!items.length && (
          <SourceGap message="This tab requires approved SWFI rows. No fallback rows are shown." />
        )}
      </div>
      {insight?.href && (
        <div className="mt-2.5">
          <a
            href={selfContainedHref(insight.href, "/search/")}
            data-source-state={insightProvenance ? "on-file" : undefined}
            title={insightProvenance ? "Source on file" : undefined}
            className="text-black text-sm font-semibold no-underline hover:underline"
          >
            View all
          </a>
        </div>
      )}
    </>
  );
}

function ItemCard({ item }: { item: InsightItem }) {
  const sourceItem = item as InsightItemWithSource;
  const href = item.profile_url || item.href || "/profiles";
  const provenance = sourceItem.source_url || sourceProvenanceHref(item.profile_url || item.href);
  return (
    <a
      href={selfContainedHref(href, "/profiles/")}
      data-source-state={provenance ? "on-file" : undefined}
      title={provenance ? "Source on file" : undefined}
      className="grid gap-1 border border-gray-300 p-2 no-underline text-inherit hover:bg-gray-50"
    >
      <strong className="text-gray-900 text-sm">{item.name || item.title || "Record"}</strong>
      <p className="m-0 text-gray-600 text-[0.8rem]">{item.note || item.strategy || item.metric || item.aum || ""}</p>
    </a>
  );
}
