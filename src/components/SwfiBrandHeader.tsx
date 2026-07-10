"use client";

import { appHref, assetHref } from "@/lib/selfContainedLinks";

// Sign-in belongs to swfi.com (source-of-truth rule; minutes C/G). There is
// no /login route in this app — the old link 404'd once the route vanished
// from the tree.
const SWFI_SIGNIN = "https://www.swfi.com/v1/signin/";

const brandLinks = [
  ["About Us", "/about/"],
  ["Products", "/products/"],
  ["Solutions", "/solutions/"],
  ["Demo", "/demo/"],
  ["Contact Us", "/contact/"],
  ["Sign In", SWFI_SIGNIN],
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
    <>
    <header data-gsap-reveal className="relative z-50 shrink-0 border-b border-[#7E1417] bg-[#A61C20] text-white">
      <div className="mx-auto flex min-h-[80px] max-w-[1296px] flex-wrap items-center gap-5 px-4 py-3 lg:flex-nowrap lg:px-[72px]">
        <a href={appHref("/")} className="flex min-w-[150px] items-center text-white no-underline" aria-label="SWFI home">
          <img src={assetHref("/swfi-assets/logo.svg")} alt="SWFI" className="h-12 w-[130px] object-contain" />
        </a>
        <nav aria-label="SWFI brand navigation" className="ml-auto flex flex-wrap items-center gap-6 text-[16px] font-bold lg:gap-12">
          {brandLinks.map(([label, href]) => {
            const rawHref = String(href);
            const target = absoluteOrAppHref(href);
            const gated = gateBrandLinks && !rawHref.startsWith("http://") && !rawHref.startsWith("https://");
            const dropdown = brandDropdowns[label] || [];
            return (
              <div key={label} className="group relative">
                <a
                  href={gated ? loginHref() : target}
                  data-dashboard-target={gated ? target : undefined}
                  className={`relative inline-flex min-h-11 items-center gap-1 text-white no-underline lg:min-h-0 after:absolute after:left-0 after:top-[calc(100%+5px)] after:h-[3px] after:w-full after:scale-x-0 after:rounded after:bg-white after:transition-transform hover:after:scale-x-100 ${label === "Sign In" ? "rounded-full border border-transparent px-4 py-3 hover:border-white hover:after:scale-x-0" : ""}`}
                >
                  <span>{label}</span>
                  {dropdown.length ? (
                    <img src={assetHref("/swfi-assets/arrowcircledown.svg")} alt="" className="h-4 w-4" />
                  ) : null}
                </a>
                {dropdown.length ? (
                  <div className="invisible absolute left-0 top-[calc(100%+27px)] z-50 hidden min-w-[280px] translate-y-2 gap-1 bg-white p-3 text-[14px] font-normal text-[#22272F] opacity-0 shadow-lg transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 lg:grid">
                    {dropdown.map(([itemLabel, itemHref]) => {
                      const itemTarget = absoluteOrAppHref(itemHref);
                      return (
                        <a
                          key={itemLabel}
                          href={gated ? loginHref() : itemTarget}
                          data-dashboard-target={gated ? itemTarget : undefined}
                          className="px-3 py-2 text-[#70798B] no-underline hover:bg-[#F8F8F8] hover:text-[#A61C20]"
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
          className="mx-auto flex h-11 max-w-[1296px] items-center overflow-hidden border border-[#C8D1E5] bg-[#F8F9FA] px-3 text-[13px] text-[#444D5F] lg:h-9"
        >
          <label htmlFor={searchId} className="shrink-0 font-semibold text-[#22272F]">Smart Search</label>
          <span className="shrink-0 text-[#70798B]">&nbsp;-&nbsp;</span>
          <input
            id={searchId}
            name="q"
            type="search"
            defaultValue={searchDefaultValue}
            className="min-w-0 flex-1 self-stretch bg-transparent text-[#41566B] outline-none placeholder:text-[#7A8A9B] lg:self-auto"
            placeholder="Institution, Person, Strategy"
          />
        </form>
      </div> : null}
    </header>
    {/* Sovereign Registry signature: guilloché band, one per page, decorative. */}
    <div className="swfi-registry-band shrink-0" aria-hidden="true">
      <span><em>Sovereign Wealth Fund Institute · Official Records Preview</em></span>
    </div>
  </>
  );
}

function loginHref(): string {
  // Gated links go to the platform sign-in; the dashboard has no login of
  // its own (data-dashboard-target still carries the intended destination).
  return SWFI_SIGNIN;
}

function absoluteOrAppHref(href: string): string {
  return href.startsWith("http://") || href.startsWith("https://") ? href : appHref(href);
}
