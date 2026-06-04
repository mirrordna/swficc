"use client";

const ACTIONS = [
  { label: "Find LPs", href: "/source-data?collection=entities" },
  { label: "View Mandates", href: "/mandates" },
  { label: "Search Deals", href: "/transactions" },
];

export default function QuickActions() {
  return (
    <section className="flex items-center gap-2.5 p-3.5 px-[18px] bg-white border border-gray-200 rounded-[10px] shadow-sm">
      <span className="text-base">&#x2B50;</span>
      <span className="text-gray-600 text-[0.68rem] font-bold font-mono uppercase tracking-wider mr-1.5">
        QUICK ACTIONS
      </span>
      {ACTIONS.map((a) => (
        <a
          key={a.label}
          href={a.href}
          className="px-[18px] py-2 bg-[#0a1628] text-white rounded-md text-[0.82rem] font-semibold no-underline hover:bg-[#a61c20] transition-colors"
        >
          {a.label}
        </a>
      ))}
    </section>
  );
}
