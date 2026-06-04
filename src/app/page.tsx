"use client";

import { useDashboard } from "@/hooks/useDashboard";
import TopNav from "@/components/TopNav";
import Sidebar from "@/components/Sidebar";
import ActionPanel from "@/components/ActionPanel";
import KPICards from "@/components/KPICards";
import InsightsPanel from "@/components/InsightsPanel";
import QuickActions from "@/components/QuickActions";
import PerformanceDashboard from "@/components/PerformanceDashboard";
import PeerComparison from "@/components/PeerComparison";
import DynamicRankings from "@/components/DynamicRankings";
import TrendAnalytics from "@/components/TrendAnalytics";
import BusinessModels from "@/components/BusinessModels";
import SectorShifts from "@/components/SectorShifts";
import RegionalAllocation from "@/components/RegionalAllocation";
import CoInvestment from "@/components/CoInvestment";
import InvestorFit from "@/components/InvestorFit";

export default function DashboardPage() {
  const { data, error, loading } = useDashboard();
  const d2 = data?.dashboard2;

  return (
    <div className="min-h-screen">
      {/* ═══ Top Nav — SWFI Logo | Smart Search Bar | Profile | Alerts ═══ */}
      <TopNav search={d2?.smart_search} />

      {/* ═══ 3-Column Layout — Sidebar | Main Dashboard | Action Panel ═══ */}
      <div className="grid grid-cols-[220px_1fr_240px] min-h-[calc(100vh-56px)] max-lg:grid-cols-[200px_1fr_200px] max-md:grid-cols-1">

        {/* Left Sidebar */}
        <Sidebar />

        {/* Main Dashboard Area */}
        <main className="flex flex-col gap-4 p-5 px-6 overflow-y-auto bg-[#f5f7fa]">

          {/* Loading state */}
          {loading && !d2 && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-2 border-gray-300 border-t-[#a61c20] rounded-full animate-spin mb-4" />
                <p className="text-gray-500 text-sm">Loading dashboard...</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !d2 && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-center">
              <strong className="block text-red-800 mb-1">Failed to load dashboard</strong>
              <p className="text-red-600 text-sm m-0">{error}</p>
              <p className="text-gray-600 text-sm mt-2">
                Make sure you are signed in at{" "}
                <a href="https://institutionalinvestorhub.com" className="text-[#1a5276] underline">
                  institutionalinvestorhub.com
                </a>
              </p>
            </div>
          )}

          {d2 && (
            <>
              {/* §1 — Snapshot KPI Cards (PDF p1: Total Institutions | Active Allocators | Live RFPs | Recent Transactions) */}
              <KPICards kpis={d2.snapshot_kpis} />

              {/* §4 — Quick Insights with tabs (PDF p7: Top Investors | Fundraising | Market Activity | News) */}
              <InsightsPanel insights={d2.quick_insights} />

              {/* Quick Actions (PDF p2: [Find LPs] [View Mandates] [Search Deals]) */}
              <QuickActions />

              {/* §2.1 — Historical Performance Dashboard (PDF p3: entity dropdown, chart type, AUM/growth/benchmark) */}
              <PerformanceDashboard data={d2.historical_performance} />

              {/* 2-column grid (PDF p4-5) */}
              <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
                {/* §2.2 / §8.2 — Peer Comparison / Competitor Intelligence Module (Game Changer) */}
                <PeerComparison data={d2.peer_comparison} />
                {/* §2.3 — Dynamic Rankings Engine */}
                <DynamicRankings rankings={d2.dynamic_rankings} />
              </div>

              {/* §8.3 — Investment Trend Analytics (PDF p13) */}
              <TrendAnalytics trends={d2.trend_analytics} />

              {/* 2-column grid (PDF p10-14) */}
              <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
                {/* §8.1 — Top-Funded Business Models Dashboard */}
                <BusinessModels models={d2.funded_business_models} />
                {/* §8.4 — Sector Shift Intelligence (Key Differentiator) */}
                <SectorShifts shifts={d2.sector_shift_heatmap} />
              </div>

              {/* §8.5 — Regional Allocation Trends (PDF p14) */}
              <RegionalAllocation regions={d2.regional_allocation} />

              {/* §8.7 / §9.4 — Co-Investment Tracking (PDF p15-16: network graph + table) */}
              <CoInvestment data={d2.co_investment_tracking} />

              {/* §9.3 — Investor Fit Targeting (PDF p18: ticket-size distribution) */}
              <InvestorFit data={d2.investor_fit_targeting} />
            </>
          )}
        </main>

        {/* Right Action Panel — Saved | Alerts | Recent | Viewed (PDF p2 wireframe) */}
        <ActionPanel
          alerts={d2?.alerts}
          savedViews={d2?.saved_views}
        />
      </div>

      {/* Footer */}
      <footer className="flex justify-between items-center px-6 py-4 bg-white border-t border-gray-200 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <span className="text-[#a61c20]">&#9670;</span>
          <strong className="text-gray-800">SWFI</strong>
          <span>&middot;</span>
          <span>Institutional investor data and intelligence</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="/profiles" className="text-gray-600 no-underline hover:text-gray-900">Profiles</a>
          <span>&middot;</span>
          <a href="/transactions" className="text-gray-600 no-underline hover:text-gray-900">Transactions</a>
          <span>&middot;</span>
          <a href="/mandates" className="text-gray-600 no-underline hover:text-gray-900">RFPs</a>
          <span>&middot;</span>
          <a href="/people" className="text-gray-600 no-underline hover:text-gray-900">People</a>
        </div>
      </footer>
    </div>
  );
}
