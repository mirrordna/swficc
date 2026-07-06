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

export default function WorldCapitalMap({ rows }: { rows: WorldCapitalRow[] }) {
  const [countries, setCountries] = useState<CountryFeature[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

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

  return (
    <div className="grid gap-1.5">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="World map of SWFI top-ranked institutions by country">
        {countries.map((countryFeature, index) => {
          const name = normalizeName(countryFeature.properties?.name || "");
          if (matchedNames.has(name)) return null;
          return <path key={`base-${index}`} d={path(countryFeature) || undefined} fill="#E9EFF4" stroke="#FFFFFF" strokeWidth="0.5" />;
        })}
        {matched.map(({ row, feature: countryFeature }) => {
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
        {matched.map(({ row, feature: countryFeature }, index) => {
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
        {labelled.map(({ row, feature: countryFeature }) => {
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
      </svg>
      {unmatched.length ? (
        <div className="text-[10px] font-semibold text-[#7B8996]">
          Not drawable on this map (still counted in the ranking): {unmatched.map((row) => `${row.country} (${row.count})`).join(", ")}
        </div>
      ) : null}
    </div>
  );
}
