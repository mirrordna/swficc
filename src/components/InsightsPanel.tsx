"use client";

import { useState } from "react";
import type { QuickInsight, InsightItem } from "@/lib/types";

const TABS = [
  { key: "top-investors", label: "Top Investors" },
  { key: "fundraising", label: "Fundraising" },
  { key: "market-activity", label: "Market Activity" },
  { key: "news", label: "News" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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
    else if (title.includes("news") || title.includes("intelligence") || i === 2) result.news = insight;
  });
  if (!result["market-activity"]) result["market-activity"] = result.fundraising;
  return result;
}

export default function InsightsPanel({ insights }: { insights: QuickInsight[] }) {
  const [activeTab, setActiveTab] = useState<TabKey>("top-investors");
  const mapped = mapInsights(insights);

  return (
    <section className="bg-white border border-gray-200 rounded-[10px] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-[18px] pt-3.5">
        <span className="text-base">&#x1F4CA;</span>
        <h2 className="m-0 text-[0.72rem] font-bold font-mono uppercase tracking-wider text-gray-600">
          INSIGHTS
        </h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-[18px] pt-2.5 border-b-2 border-gray-200" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-[18px] py-2.5 border-0 bg-transparent text-sm font-semibold cursor-pointer border-b-2 -mb-[2px] transition-colors ${
              activeTab === tab.key
                ? "text-[#0a1628] border-[#a61c20] font-bold"
                : "text-gray-500 border-transparent hover:text-gray-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-[18px] min-h-[120px]">
        <TabContent tabKey={activeTab} insight={mapped[activeTab]} />
      </div>
    </section>
  );
}

function TabContent({ tabKey, insight }: { tabKey: TabKey; insight: QuickInsight | null }) {
  const items = insight?.items || [];

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
                  {item.profile_url ? (
                    <a href={item.profile_url} className="text-[#1a5276] font-semibold no-underline hover:underline">
                      {item.name || item.title || "Institution"}
                    </a>
                  ) : (
                    <span className="font-semibold">{item.name || item.title || "Institution"}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.metric || item.aum || "Current"}</td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.strategy || item.sector || item.note || "Multi-strategy"}</td>
                <td className="px-3 py-2.5 text-sm text-gray-800 border-b border-gray-100">{item.country || item.region || "Global"}</td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={4} className="text-center text-gray-500 py-6">Loading investor data...</td></tr>
            )}
          </tbody>
        </table>
        {insight?.href && (
          <div className="mt-2.5">
            <a href={insight.href} className="text-[#1a5276] text-sm font-semibold no-underline hover:underline">View all active investors &rarr;</a>
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
          <p className="text-center text-gray-400 text-sm py-6">Loading data...</p>
        )}
      </div>
      {insight?.href && (
        <div className="mt-2.5">
          <a href={insight.href} className="text-[#1a5276] text-sm font-semibold no-underline hover:underline">View all &rarr;</a>
        </div>
      )}
    </>
  );
}

function ItemCard({ item }: { item: InsightItem }) {
  const href = item.profile_url || item.href || "/profiles";
  return (
    <a href={href} className="grid gap-1 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors">
      <strong className="text-gray-900 text-sm">{item.name || item.title || "Record"}</strong>
      <p className="m-0 text-gray-600 text-[0.8rem]">{item.note || item.strategy || item.metric || item.aum || ""}</p>
    </a>
  );
}
