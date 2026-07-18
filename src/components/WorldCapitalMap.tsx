"use client";

// Global Capital Map — ECharts engine ported from the demo2 terminal build
// (Paul 2026-07-06: "you can use the demo2 world capital map on the
// dashboard"): animated flow arcs with moving direction arrows, ripple
// hubs, rich tooltips — demo2's living-map feel on THIS build's verified
// data truth. Geometry: Natural Earth 50m shapes (public domain, shipped
// locally), converted topojson→geojson client-side. Honesty rules carried
// over unchanged: every country in the data appears or is DISCLOSED as
// not-drawable; AUM/USD figures only where the source disclosed them
// (per-pair coverage in tooltips); flow anchors come from inline source
// fields only — never name-search resolution (probe receipt 2026-07-06).

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { GeoComponent, TooltipComponent } from "echarts/components";
import { EffectScatterChart, LinesChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import { geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import { appHref, assetHref } from "@/lib/selfContainedLinks";

echarts.use([GeoComponent, TooltipComponent, EffectScatterChart, LinesChart, CanvasRenderer]);

export type WorldCapitalRow = {
  country: string;
  count: number;
  aum: number;
  aumCurrency: string;
  topName: string;
};

export type WorldFlowPair = {
  source: string;
  target: string;
  deals: number;
  buyers: number;
  usd: number;
  usdDeals: number;
};

type CountryFeature = Feature<Geometry, { name?: string }>;

const NAME_ALIASES: Record<string, string> = {
  "united states": "united states of america",
  usa: "united states of america",
  "hong kong": "hong kong s.a.r.",
  "russian federation": "russia",
  uae: "united arab emirates",
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function compactValue(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(value >= 1e13 ? 0 : 1)}T`;
  if (value >= 1e9) return `${Math.round(value / 1e9)}B`;
  if (value >= 1e6) return `${Math.round(value / 1e6)}M`;
  return `${Math.round(value)}`;
}

function aumLabel(row: WorldCapitalRow): string {
  if (!row.aum || !row.aumCurrency) return "AUM: mixed currencies";
  return row.aumCurrency === "USD" ? `$${compactValue(row.aum)}` : `${row.aumCurrency} ${compactValue(row.aum)}`;
}

function usdShort(value: number): string {
  return value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `$${Math.round(value / 1e6)}M` : `$${Math.round(value / 1e3)}K`;
}

function flowTip(pair: WorldFlowPair): string {
  const value = pair.usd ? `${usdShort(pair.usd)} disclosed (${pair.usdDeals} of ${pair.deals})` : "value not disclosed";
  return `${pair.source} → ${pair.target}: ${pair.deals} ${pair.deals === 1 ? "deal" : "deals"} · ${value}`;
}

export default function WorldCapitalMap({ rows, flows = [] }: { rows: WorldCapitalRow[]; flows?: WorldFlowPair[] }) {
  const [geoIndex, setGeoIndex] = useState<{ names: Map<string, string>; centroids: Map<string, [number, number]> } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<"institutions" | "flows">("institutions");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(assetHref("/swfi-assets/countries-50m.json"), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((topology: Topology<{ countries: GeometryCollection<{ name?: string }> }>) => {
        const collection = feature(topology, topology.objects.countries);
        const features = collection.features as CountryFeature[];
        const names = new Map<string, string>();
        const centroids = new Map<string, [number, number]>();
        for (const countryFeature of features) {
          const rawName = countryFeature.properties?.name || "";
          const key = normalizeName(rawName);
          if (!key) continue;
          names.set(key, rawName);
          const centroid = geoCentroid(countryFeature);
          if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) {
            centroids.set(key, [centroid[0], centroid[1]]);
          }
        }
        echarts.registerMap("world", collection as unknown as Parameters<typeof echarts.registerMap>[1]);
        setGeoIndex({ names, centroids });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const resolved = useMemo(() => {
    const lookup = (country: string) => {
      const key = normalizeName(country);
      const alias = NAME_ALIASES[key] || key;
      return geoIndex?.names.has(alias) ? alias : geoIndex?.names.has(key) ? key : null;
    };
    const matched: { row: WorldCapitalRow; geoKey: string }[] = [];
    const unmatched: WorldCapitalRow[] = [];
    for (const row of rows) {
      const geoKey = geoIndex ? lookup(row.country) : null;
      if (geoKey) matched.push({ row, geoKey });
      else unmatched.push(row);
    }
    const crossFlows: { pair: WorldFlowPair; from: [number, number]; to: [number, number] }[] = [];
    const domesticFlows: { pair: WorldFlowPair; at: [number, number] }[] = [];
    const unmappableFlows: WorldFlowPair[] = [];
    for (const pair of flows) {
      const sourceKey = geoIndex ? lookup(pair.source) : null;
      const targetKey = geoIndex ? lookup(pair.target) : null;
      const from = sourceKey ? geoIndex?.centroids.get(sourceKey) : undefined;
      const to = targetKey ? geoIndex?.centroids.get(targetKey) : undefined;
      if (!from || !to) unmappableFlows.push(pair);
      else if (pair.source === pair.target) domesticFlows.push({ pair, at: from });
      else crossFlows.push({ pair, from, to });
    }
    return { matched, unmatched, crossFlows, domesticFlows, unmappableFlows };
  }, [rows, flows, geoIndex]);

  useEffect(() => {
    if (!geoIndex || !hostRef.current) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(hostRef.current);
      chartRef.current.on("click", (event: { seriesName?: string; name?: string }) => {
        if (event.name && (event.seriesName === "institution-hubs" || event.seriesName === "flow-hubs")) {
          window.location.href = appHref(`/profiles/?filter=${encodeURIComponent(event.name)}`);
        }
      });
    }
    const chart = chartRef.current;
    const { matched, crossFlows, domesticFlows } = resolved;
    const maxCount = Math.max(1, ...matched.map(({ row }) => row.count));
    const maxDeals = Math.max(1, ...crossFlows.map(({ pair }) => pair.deals), ...domesticFlows.map(({ pair }) => pair.deals));
    const geoBase = {
      map: "world",
      roam: false,
      silent: true,
      top: 4,
      bottom: 4,
      left: 4,
      right: 4,
      itemStyle: { areaColor: "#E9EFF4", borderColor: "#FFFFFF", borderWidth: 0.6 },
    };

    if (mode === "institutions") {
      const top5 = new Set(matched.slice(0, 5).map(({ row }) => row.country));
      chart.setOption(
        {
          tooltip: { trigger: "item", backgroundColor: "#0A2342", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } },
          geo: {
            ...geoBase,
            regions: matched.map(({ row, geoKey }) => {
              const intensity = Math.sqrt(row.count / maxCount);
              return {
                name: geoIndex.names.get(geoKey) || row.country,
                itemStyle: { areaColor: intensity > 0.66 ? "#3D86CB" : intensity > 0.33 ? "#7FAEDD" : "#BAD3EC" },
              };
            }),
          },
          series: [
            {
              name: "institution-hubs",
              type: "effectScatter",
              coordinateSystem: "geo",
              zlevel: 3,
              rippleEffect: { brushType: "stroke", scale: 2.4 },
              symbolSize: (value: number[]) => 8 + Math.sqrt((value[2] || 1) / maxCount) * 18,
              itemStyle: { color: "#0A66C2", shadowBlur: 8, shadowColor: "rgba(10,102,194,.35)" },
              label: {
                show: true,
                position: "bottom",
                // On-map labels stay short: country + AUM only when one
                // currency backs it; the tooltip carries the full detail.
                formatter: (params: { name: string; data: { labelAum: string } }) =>
                  top5.has(params.name) ? (params.data.labelAum ? `${params.name} · ${params.data.labelAum}` : params.name) : "",
                color: "#22313F",
                fontSize: 10,
                fontWeight: 700,
              },
              data: matched.map(({ row, geoKey }, index) => ({
                name: row.country,
                value: [...(geoIndex.centroids.get(geoKey) || [0, 0]), row.count],
                labelAum: row.aum && row.aumCurrency ? aumLabel(row) : "",
                tipAum: aumLabel(row),
                tipTop: row.topName,
                itemStyle: index === 0 ? { color: "#A61C20", shadowColor: "rgba(166,28,32,.35)" } : undefined,
              })),
              tooltip: {
                formatter: (params: { name: string; value: number[]; data: { tipAum: string; tipTop: string } }) =>
                  `${params.name}: ${params.value[2]} ${params.value[2] === 1 ? "institution" : "institutions"} · ${params.data.tipAum}${params.data.tipTop ? ` · top: ${params.data.tipTop}` : ""}`,
              },
            },
            { name: "flow-lines", type: "lines", coordinateSystem: "geo", data: [] },
            { name: "flow-hubs", type: "effectScatter", coordinateSystem: "geo", data: [] },
          ],
        },
        { replaceMerge: ["series", "geo"] },
      );
    } else {
      const involvement = new Map<string, { deals: number; at: [number, number] }>();
      for (const { pair, from, to } of crossFlows) {
        const src = involvement.get(pair.source) || { deals: 0, at: from };
        src.deals += pair.deals;
        involvement.set(pair.source, src);
        const dst = involvement.get(pair.target) || { deals: 0, at: to };
        dst.deals += pair.deals;
        involvement.set(pair.target, dst);
      }
      for (const { pair, at } of domesticFlows) {
        const hub = involvement.get(pair.source) || { deals: 0, at };
        hub.deals += pair.deals;
        involvement.set(pair.source, hub);
      }
      const domesticByCountry = new Map(domesticFlows.map(({ pair }) => [pair.source, pair]));
      chart.setOption(
        {
          tooltip: { trigger: "item", backgroundColor: "#0A2342", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } },
          geo: {
            ...geoBase,
            regions: [...involvement.keys()].map((country) => {
              const key = normalizeName(country);
              const alias = NAME_ALIASES[key] || key;
              return { name: geoIndex.names.get(alias) || geoIndex.names.get(key) || country, itemStyle: { areaColor: "#CBDDEF" } };
            }),
          },
          series: [
            {
              name: "flow-lines",
              type: "lines",
              coordinateSystem: "geo",
              zlevel: 2,
              effect: { show: true, period: 5, trailLength: 0.25, symbol: "arrow", symbolSize: 5, color: "#1B4F8A" },
              lineStyle: { color: "#0A66C2", opacity: 0.4, curveness: 0.3 },
              data: crossFlows.map(({ pair, from, to }) => ({
                coords: [from, to],
                lineStyle: { width: 1 + 3 * (pair.deals / maxDeals) },
                tip: flowTip(pair),
              })),
              tooltip: { formatter: (params: { data: { tip: string } }) => params.data.tip },
            },
            {
              name: "flow-hubs",
              type: "effectScatter",
              coordinateSystem: "geo",
              zlevel: 3,
              rippleEffect: { brushType: "stroke", scale: 2.2 },
              symbolSize: (value: number[]) => 6 + Math.sqrt((value[2] || 1) / Math.max(1, ...[...involvement.values()].map((entry) => entry.deals))) * 14,
              itemStyle: { color: "#0A66C2", shadowBlur: 6, shadowColor: "rgba(10,102,194,.3)" },
              label: {
                show: true,
                position: "bottom",
                // Label only the busiest hubs — the Europe cluster collides
                // when every hub is named; the rest stay in tooltips.
                formatter: (params: { name: string; data: { labelled: boolean } }) => (params.data.labelled ? params.name : ""),
                color: "#22313F",
                fontSize: 9.5,
                fontWeight: 700,
              },
              data: (() => {
                const topHubs = new Set([...involvement.entries()].sort((a, b) => b[1].deals - a[1].deals).slice(0, 8).map(([country]) => country));
                return [...involvement.entries()].map(([country, entry]) => ({
                  name: country,
                  value: [...entry.at, entry.deals],
                  labelled: topHubs.has(country),
                  tipDomestic: domesticByCountry.get(country) ? `${domesticByCountry.get(country)!.deals} domestic` : "",
                }));
              })(),
              tooltip: {
                formatter: (params: { name: string; value: number[]; data: { tipDomestic: string } }) =>
                  `${params.name}: ${params.value[2]} connecting ${params.value[2] === 1 ? "deal" : "deals"}${params.data.tipDomestic ? ` (${params.data.tipDomestic})` : ""}`,
              },
            },
            { name: "institution-hubs", type: "effectScatter", coordinateSystem: "geo", data: [] },
          ],
        },
        { replaceMerge: ["series", "geo"] },
      );
    }
  }, [geoIndex, mode, resolved]);

  useEffect(() => {
    if (!hostRef.current) return;
    const observer = new ResizeObserver(() => chartRef.current?.resize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  if (loadFailed) {
    return (
      <div className="grid min-h-[220px] content-center rounded-[6px] bg-[#F7FAFD] p-3 text-center text-[12px] font-semibold text-[#526171]">
        World map data unavailable — the country ranking below carries the same information.
      </div>
    );
  }

  const { unmatched, crossFlows, domesticFlows, unmappableFlows } = resolved;
  const showFlows = mode === "flows" && flows.length > 0;

  return (
    <div className="grid gap-1.5">
      {flows.length ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 text-[10px] font-extrabold uppercase tracking-[0.08em]">
            <button
              type="button"
              onClick={() => setMode("institutions")}
              className={`rounded px-2 py-1 ${mode === "institutions" ? "bg-[#0A3A7A] text-white" : "bg-[#EDF2F7] text-[#41566B]"}`}
            >
              Institutions
            </button>
            <button
              type="button"
              onClick={() => setMode("flows")}
              className={`rounded px-2 py-1 ${mode === "flows" ? "bg-[#0A3A7A] text-white" : "bg-[#EDF2F7] text-[#41566B]"}`}
            >
              Deal flows
            </button>
          </div>
          <span className="text-[9.5px] font-semibold text-[#7B8996]">
            {showFlows ? "buyer country → deal location, deals loaded on this page" : "from the loaded SWFI ranking rows"}
          </span>
        </div>
      ) : null}
      <div
        ref={hostRef}
        role="img"
        aria-label={showFlows ? "World map of capital flows from buyer countries to deal locations" : "World map of SWFI top-ranked institutions by country"}
        className="h-[400px] w-full rounded-[6px] bg-[#F8FBFF]"
      >
        {!geoIndex ? <div className="grid h-full content-center text-center text-[12px] font-semibold text-[#526171]">Loading map…</div> : null}
      </div>
      {showFlows ? (
        <div className="text-[10px] font-semibold text-[#7B8996]">
          Moving arrows = deal direction (buyer country → deal location); line width = connecting deals; ripple hubs = countries in the loaded deals ({domesticFlows.length ? `domestic deals included in hub totals: ${domesticFlows.map(({ pair }) => `${pair.source} ${pair.deals}`).join(", ")}` : "no domestic deals in the loaded rows"}). USD totals appear in tooltips only where the deal value is disclosed — never estimated.
          {unmappableFlows.length ? ` Not drawable: ${unmappableFlows.map((pair) => `${pair.source}→${pair.target} (${pair.deals})`).join(", ")}.` : ""}
          {` ${crossFlows.length} cross-border ${crossFlows.length === 1 ? "route" : "routes"} drawn.`}
        </div>
      ) : unmatched.length ? (
        <div className="text-[10px] font-semibold text-[#7B8996]">
          Not drawable on this map (still counted in the ranking): {unmatched.map((row) => `${row.country} (${row.count})`).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
