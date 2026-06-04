"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const MAIN_LINKS = [
  { href: "/", label: "Dashboard", icon: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  { href: "/profiles", label: "Institutions", icon: "M3 21h18M3 7h18M5 21V7l7-4 7 4v14" },
  { href: "/people", label: "People", icon: "M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-4 4-7 8-7s8 3 8 7" },
  { href: "/transactions", label: "Transactions", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  { href: "/mandates", label: "RFPs", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" },
  { href: "/research", label: "Reports", icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" },
  { href: "#saved", label: "Saved Lists", icon: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" },
];

const QUICK_LINKS = [
  { href: "/ask-swfi", label: "Ask SWFI", icon: "M11 11a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35", cta: true },
  { href: "/source-data", label: "Data Browser", icon: "M12 5a9 3 0 1 0 0-6 9 3 0 0 0 0 6zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" },
  { href: "/signal-desk", label: "Market Signals", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-[18px] h-[18px] flex-shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d={d} />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col gap-0 py-4 bg-white border-r border-gray-200 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto w-[220px] min-w-[220px]">
      <nav className="flex flex-col gap-0.5 px-2">
        {MAIN_LINKS.map((link) => {
          const active = pathname === link.href || (link.href === "/" && pathname === "/dashboard");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm no-underline transition-colors ${
                active
                  ? "bg-[#0a1628]/[0.08] text-[#0a1628] font-bold"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium"
              }`}
            >
              <NavIcon d={link.icon} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 pt-4 border-t border-gray-200">
        <p className="px-5 mb-2 text-[0.66rem] font-bold text-gray-500 uppercase tracking-wider font-mono">
          Quick links
        </p>
        <nav className="flex flex-col gap-0.5 px-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm no-underline transition-colors ${
                link.cta
                  ? "text-[#a61c20] font-semibold hover:bg-red-50"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium"
              }`}
            >
              <NavIcon d={link.icon} />
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}
