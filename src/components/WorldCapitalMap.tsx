"use client";

// Real geography for the Global Capital Map (Paul 2026-07-06: wanted a map,
// amCharts-style — not the invented dot-continents, and not no-map-at-all).
// Natural Earth 50m country shapes (public domain, shipped locally at
// /swfi-assets/countries-50m.json), d3-geo Natural Earth projection.
// Honesty rules carried over: every country in the data appears (no
// hardcoded coordinate table), AUM text only when one currency backs it,
// countries the atlas cannot match are DISCLOSED, never dropped silently.

import { useEffect, useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import { appHref, assetHref } from "@/lib/selfContainedLinks";

export type WorldCapitalRow = {
  country: string;
  count: number;
  aum: number;
  aumCurrency: string;
  topName: string;
};

// One aggregated buyer-country → deal-country connection (Paul 2026-07-06:
// "make the map interactive like where the flows are going"). Weights are
// DEAL COUNTS (100% coverage, no value imputation); USD sums ride along for
// the tooltip with their own disclosed-deal coverage.
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
  "south korea": "south korea",
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

export default function WorldCapitalMap({ rows, flows = [] }: { rows: WorldCapitalRow[]; flows?: WorldFlowPair[] }) {
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<"institutions" | "flows">("institutions");
  const [hoverFlow, setHoverFlow] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(assetHref("/swfi-assets/countries-50m.json"), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((topology: Topology<{ countries: GeometryCollection<{ name?: string }> }>) => {
        const collection = feature(topology, topology.objects.countries);
        setCountries(collection.features as CountryFeature[]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const { matched, unmatched, maxCount } = useMemo(() => {
    const byName = new Map<string, CountryFeature>();
    for (const featureRow of countries || []) {
      const name = normalizeName(featureRow.properties?.name || "");
      if (name) byName.set(name, featureRow);
    }
    const matchedRows: { row: WorldCapitalRow; feature: CountryFeature }[] = [];
    const unmatchedRows: WorldCapitalRow[] = [];
    for (const row of rows) {
      const key = normalizeName(row.country);
      const alias = NAME_ALIASES[key] || key;
      const found = byName.get(alias) || byName.get(key);
      if (found) matchedRows.push({ row, feature: found });
      else unmatchedRows.push(row);
    }
    return {
      matched: matchedRows,
      unmatched: unmatchedRows,
      maxCount: Math.max(1, ...rows.map((row) => row.count)),
    };
  }, [countries, rows]);

  if (loadFailed) {
    return (
      <div className="grid min-h-[220px] content-center rounded-[6px] bg-[#F7FAFD] p-3 text-center text-[12px] font-semibold text-[#526171]">
        World map data unavailable — the country ranking below carries the same information.
      </div>
    );
  }
  if (!countries) {
    return (
      <div className="grid min-h-[220px] content-center rounded-[6px] bg-[#F7FAFD] p-3 text-center text-[12px] font-semibold text-[#526171]">
        Loading map…
      </div>
    );
  }

  const width = 980;
  const height = 430;
  const projection = geoNaturalEarth1().fitExtent(
    [
      [8, 8],
      [width - 8, height - 8],
    ],
    { type: "Sphere" },
  );
  const path = geoPath(projection);
  const matchedNames = new Set(matched.map((entry) => normalizeName(entry.feature.properties?.name || "")));
  const labelled = matched.slice(0, 5);

  // Flow-mode geometry: resolve each pair's endpoints against the SAME atlas
  // matching used for institutions; unmatched endpoints get disclosed.
  const byName = new Map<string, CountryFeature>();
  for (const featureRow of countries) {
    const name = normalizeName(featureRow.properties?.name || "");
    if (name) byName.set(name, featureRow);
  }
  const centroidFor = (country: string): [number, number] | null => {
    const key = normalizeName(country);
    const found = byName.get(NAME_ALIASES[key] || key) || byName.get(key);
    if (!found) return null;
    return projection(geoCentroid(found)) || null;
  };
  const crossFlows: { pair: WorldFlowPair; from: [number, number]; to: [number, number] }[] = [];
  const domesticFlows: { pair: WorldFlowPair; at: [number, number] }[] = [];
  const unmappableFlows: WorldFlowPair[] = [];
  const maxDeals = Math.max(1, ...flows.map((pair) => pair.deals));
  for (const pair of flows) {
    const from = centroidFor(pair.source);
    const to = centroidFor(pair.target);
    if (!from || !to) {
      unmappableFlows.push(pair);
    } else if (pair.source === pair.target) {
      domesticFlows.push({ pair, at: from });
    } else {
      crossFlows.push({ pair, from, to });
    }
  }
  const flowCountries = new Set(flows.flatMap((pair) => [normalizeName(pair.source), normalizeName(pair.target)]));
  const usdShort = (value: number) => (value >= 1e9 ? `$${(value / 1e9).toFixed(1)}B` : value >= 1e6 ? `$${Math.round(value / 1e6)}M` : `$${Math.round(value / 1e3)}K`);
  const flowLabel = (pair: WorldFlowPair) =>
    `${pair.source} → ${pair.target} · ${pair.deals} ${pair.deals === 1 ? "deal" : "deals"}${pair.usd ? ` · ${usdShort(pair.usd)} disclosed (${pair.usdDeals} of ${pair.deals})` : " · value not disclosed"}`;
  const hovered = hoverFlow !== null ? crossFlows[hoverFlow] : null;

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
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={showFlows ? "World map of capital flows from buyer countries to deal locations" : "World map of SWFI top-ranked institutions by country"}>
        <defs>
          <marker id="flowArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="#0A66C2" />
          </marker>
        </defs>
        {countries.map((countryFeature, index) => {
          const name = normalizeName(countryFeature.properties?.name || "");
          if (!showFlows && matchedNames.has(name)) return null;
          const inFlow = showFlows && flowCountries.has(name);
          return <path key={`base-${index}`} d={path(countryFeature) || undefined} fill={inFlow ? "#CBDDEF" : "#E9EFF4"} stroke="#FFFFFF" strokeWidth="0.5" />;
        })}
        {!showFlows && matched.map(({ row, feature: countryFeature }) => {
          const intensity = Math.sqrt(row.count / maxCount);
          const fill = intensity > 0.66 ? "#3D86CB" : intensity > 0.33 ? "#7FAEDD" : "#BAD3EC";
          return (
            <a key={`country-${row.country}`} href={appHref(`/profiles/?filter=${encodeURIComponent(row.country)}`)}>
              <path d={path(countryFeature) || undefined} fill={fill} stroke="#FFFFFF" strokeWidth="0.6">
                <title>{`${row.country}: ${row.count} ${row.count === 1 ? "institution" : "institutions"} · ${aumLabel(row)}${row.topName ? ` · top: ${row.topName}` : ""}`}</title>
              </path>
            </a>
          );
        })}
        {!showFlows && matched.map(({ row, feature: countryFeature }, index) => {
          const [x, y] = projection(geoCentroid(countryFeature)) || [0, 0];
          const radius = 4 + Math.sqrt(row.count / maxCount) * 13;
          const lead = index === 0;
          return (
            <a key={`bubble-${row.country}`} href={appHref(`/profiles/?filter=${encodeURIComponent(row.country)}`)}>
              <g>
                <circle cx={x} cy={y} r={radius} fill={lead ? "#A61C20" : "#0A66C2"} opacity="0.92" stroke="#FFFFFF" strokeWidth="1.6">
                  <title>{`${row.country}: ${row.count} ${row.count === 1 ? "institution" : "institutions"} · ${aumLabel(row)}`}</title>
                </circle>
                <text x={x} y={y + 3.5} textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="900">{row.count}</text>
              </g>
            </a>
          );
        })}
        {!showFlows && labelled.map(({ row, feature: countryFeature }) => {
          const [x, y] = projection(geoCentroid(countryFeature)) || [0, 0];
          const radius = 4 + Math.sqrt(row.count / maxCount) * 13;
          return (
            <text
              key={`label-${row.country}`}
              x={x}
              y={y + radius + 11}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="800"
              fill="#2E4157"
              stroke="#FFFFFF"
              strokeWidth="2.6"
              paintOrder="stroke"
            >
              {row.aum && row.aumCurrency ? `${row.country} · ${aumLabel(row)}` : row.country}
            </text>
          );
        })}
        {showFlows && crossFlows.map(({ pair, from, to }, index) => {
          const [x0, y0] = from;
          const [x1, y1] = to;
          const distance = Math.hypot(x1 - x0, y1 - y0);
          const midX = (x0 + x1) / 2;
          const midY = (y0 + y1) / 2 - Math.max(18, distance * 0.22);
          const strokeWidth = 1.5 + Math.sqrt(pair.deals / maxDeals) * 4.5;
          const dim = hoverFlow !== null && hoverFlow !== index;
          return (
            <g key={`flow-${pair.source}-${pair.target}`} onMouseEnter={() => setHoverFlow(index)} onMouseLeave={() => setHoverFlow(null)}>
              <path
                d={`M${x0},${y0} Q${midX},${midY} ${x1},${y1}`}
                fill="none"
                stroke="#0A66C2"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                opacity={dim ? 0.15 : hoverFlow === index ? 0.95 : 0.55}
                markerEnd="url(#flowArrow)"
              >
                <title>{flowLabel(pair)}</title>
              </path>
              {/* invisible fat hit-area so thin arcs are hoverable */}
              <path d={`M${x0},${y0} Q${midX},${midY} ${x1},${y1}`} fill="none" stroke="transparent" strokeWidth={Math.max(12, strokeWidth + 8)} />
            </g>
          );
        })}
        {showFlows && domesticFlows.map(({ pair, at }) => {
          const [x, y] = at;
          const radius = 6 + Math.sqrt(pair.deals / maxDeals) * 9;
          return (
            <g key={`dom-${pair.source}`}>
              <circle cx={x} cy={y} r={radius} fill="none" stroke="#0A66C2" strokeWidth="2" strokeDasharray="4 3" opacity="0.75">
                <title>{`${pair.source}: ${pair.deals} domestic ${pair.deals === 1 ? "deal" : "deals"}${pair.usd ? ` · ${usdShort(pair.usd)} disclosed (${pair.usdDeals} of ${pair.deals})` : ""}`}</title>
              </circle>
              <text x={x} y={y + 3.5} textAnchor="middle" fill="#0A3A7A" fontSize="9.5" fontWeight="900">{pair.deals}</text>
              <text x={x} y={y + radius + 10} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#2E4157" stroke="#FFFFFF" strokeWidth="2.4" paintOrder="stroke">{pair.source}</text>
            </g>
          );
        })}
      </svg>
      {showFlows ? (
        <div className="grid gap-1 text-[10px] font-semibold text-[#7B8996]">
          <div className="min-h-[14px] font-bold text-[#0A3A7A]">
            {hovered ? flowLabel(hovered.pair) : "Hover an arc for the pair's deals and disclosed value."}
          </div>
          <div>
            Arrow width = number of connecting deals (buyer country → deal location). Dashed rings = domestic deals. USD totals appear only where the deal value is disclosed — never estimated.
            {unmappableFlows.length ? ` Not drawable: ${unmappableFlows.map((pair) => `${pair.source}→${pair.target} (${pair.deals})`).join(", ")}.` : ""}
          </div>
        </div>
      ) : unmatched.length ? (
        <div className="text-[10px] font-semibold text-[#7B8996]">
          Not drawable on this map (still counted in the ranking): {unmatched.map((row) => `${row.country} (${row.count})`).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
