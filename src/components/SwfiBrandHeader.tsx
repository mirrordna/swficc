"use client";

import { appHref, assetHref } from "@/lib/selfContainedLinks";

const brandLinks = [
  ["About Us", "/about/"],
  ["Solutions", "/solutions/"],
  ["Demo", "/demo/"],
  ["Contact Us", "/contact/"],
  ["Sign In", "/login/"],
] as const;

const brandDropdowns: Record<string, readonly (readonly [string, string])[]> = {
  "About Us": [
    ["Overview", "/about-us/overview/"],
    ["Our Team", "/about-us/our-team/"],
  ],
  Solutions: [
    ["Fundraising & Finding Buyers", "/solutions/#Fundraising"],
    ["Industry Intelligence & Rankings", "/solutions/#Industry"],
    ["Due Diligence & KYC", "/solutions/#Diligence"],
    ["Asset Owner Intelligence & Data Flow", "/solutions/#Intelligence"],
    ["Business Development & Networking", "/solutions/#Business"],
    ["Deal Trends & Sourcing", "/solutions/#Sourcing"],
    ["Investor Benchmarking", "/solutions/#Investor"],
  ],
};

export default function SwfiBrandHeader({
  searchId = "global-swfi-search",
  searchDefaultValue = "",
  gateBrandLinks = false,
  showSearch = true,
}: {
  searchId?: string;
  searchDefaultValue?: string;
  gateBrandLinks?: boolean;
  showSearch?: boolean;
}) {
  return (
    <header data-gsap-reveal className="relative z-50 shrink-0 border-b border-[#7E1417] bg-[#A61C20] text-white">
      <div className="mx-auto flex min-h-[72px] max-w-[1296px] flex-wrap items-center gap-4 px-4 py-3 lg:flex-nowrap lg:px-[72px]">
        <a href={appHref("/")} className="flex min-w-[190px] items-center text-white no-underline" aria-label="SWFI home">
          <img src={assetHref("/swfi-assets/logo.svg")} alt="SWFI" className="h-12 w-[130px]" />
        </a>
        <nav aria-label="SWFI brand navigation" className="ml-auto flex flex-wrap items-center gap-5 text-[15px] font-semibold">
          {brandLinks.map(([label, href]) => {
            const rawHref = String(href);
            const target = absoluteOrAppHref(href);
            const gated = gateBrandLinks && !rawHref.startsWith("http://") && !rawHref.startsWith("https://") && rawHref !== "/login/";
            const dropdown = brandDropdowns[label] || [];
            return (
              <div key={label} className="group relative">
                <a
                  href={gated ? loginHref(target) : target}
                  data-dashboard-target={gated ? target : undefined}
                  className="inline-flex items-center gap-1 text-white no-underline hover:underline"
                >
                  <span>{label}</span>
                  {dropdown.length ? (
                    <img src={assetHref("/swfi-assets/arrowcircledown.svg")} alt="" className="h-4 w-4" />
                  ) : null}
                </a>
                {dropdown.length ? (
                  <div className="invisible absolute right-0 top-full z-50 grid min-w-[260px] translate-y-2 gap-1 rounded bg-white p-3 text-[14px] font-semibold text-[#22272F] opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    {dropdown.map(([itemLabel, itemHref]) => {
                      const itemTarget = absoluteOrAppHref(itemHref);
                      return (
                        <a
                          key={itemLabel}
                          href={gated ? loginHref(itemTarget) : itemTarget}
                          data-dashboard-target={gated ? itemTarget : undefined}
                          className="rounded px-3 py-2 text-[#22272F] no-underline hover:bg-[#F8F8F8] hover:text-[#A61C20]"
                        >
                          {itemLabel}
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>
      {showSearch ? <div className="border-t border-white/15 bg-white px-4 py-2 lg:px-[72px]">
        <form
          action="/swficc/search/"
          method="get"
          className="mx-auto flex h-9 max-w-[1296px] items-center overflow-hidden rounded border border-[#C7D2DD] bg-[#F7F9FA] px-3 text-[13px] text-[#41566B]"
        >
          <label htmlFor={searchId} className="shrink-0 font-semibold text-[#11314F]">Smart Search Bar</label>
          <span className="shrink-0 text-[#7A8A9B]">&nbsp;-&nbsp;</span>
          <input
            id={searchId}
            name="q"
            type="search"
            defaultValue={searchDefaultValue}
            className="min-w-0 flex-1 bg-transparent text-[#41566B] outline-none placeholder:text-[#7A8A9B]"
            placeholder="Institution, Person, Strategy"
          />
        </form>
      </div> : null}
    </header>
  );
}

function loginHref(target: string): string {
  return `${appHref("/login/")}?${new URLSearchParams({ next: target }).toString()}`;
}

function absoluteOrAppHref(href: string): string {
  return href.startsWith("http://") || href.startsWith("https://") ? href : appHref(href);
}
