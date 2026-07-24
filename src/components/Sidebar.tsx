"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { appHref } from "@/lib/selfContainedLinks";

const MAIN_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/profiles", label: "Institutions" },
  { href: "/people", label: "People" },
  { href: "/deals", label: "Deals" },
  { href: "/transactions", label: "Transactions" },
  { href: "/comparisons", label: "Comparisons" },
  { href: "/mandates", label: "RFPs" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/research", label: "Reports" },
  { href: "/search", label: "Search" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col bg-white border-r border-gray-300 min-h-0 w-full min-w-0 md:min-h-[calc(100vh-56px)] md:w-[220px] md:min-w-[220px]">
      <div className="border-b border-gray-300 px-3 py-2 text-base font-semibold text-[#11314F]">SWFI Terminal</div>
      <nav className="flex flex-col">
        {MAIN_LINKS.map((link) => {
          const active = pathname === link.href || (link.href === "/" && pathname === "/dashboard");
          return (
            <Link
              key={link.href}
              href={appHref(link.href)}
              className={`border-b border-gray-200 px-3 py-2 text-base no-underline ${
                active
                  ? "text-black font-semibold bg-gray-50"
                  : "text-black hover:bg-gray-50"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
