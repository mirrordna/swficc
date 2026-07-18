"use client";

import { selfContainedHref } from "@/lib/selfContainedLinks";

const ACTIONS = [
  { label: "Find LPs", href: "/profiles/?filter=Sovereign%20Wealth%20Fund&entity_type=Sovereign%20Wealth%20Fund" },
  { label: "View Mandates", href: "/mandates" },
  { label: "Search Deals", href: "/deals" },
  { label: "Comparisons", href: "/comparisons" },
  { label: "Intelligence", href: "/intelligence" },
  { label: "Historical Performance", href: "/reports/#historical-performance-dashboard" },
];

export default function QuickActions() {
  return (
    <section className="flex flex-wrap items-center gap-2 border border-gray-300 bg-white px-3 py-2">
      <span className="text-base font-semibold">
        QUICK ACTIONS
      </span>
      {ACTIONS.map((a) => (
        <a
          key={a.label}
          href={selfContainedHref(a.href, "/search/")}
          className="border border-gray-300 px-3 py-1.5 text-sm text-black no-underline hover:bg-gray-50"
        >
          [{a.label}]
        </a>
      ))}
    </section>
  );
}
