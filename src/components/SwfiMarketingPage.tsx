import type { ReactNode } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { appHref, assetHref } from "@/lib/selfContainedLinks";

type MarketingSection = {
  id?: string;
  title: string;
  body: ReactNode;
};

export function SwfiMarketingPage({
  eyebrow,
  title,
  subtitle,
  children,
  sections = [],
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  sections?: MarketingSection[];
}) {
  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId={`brand-${eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-search`} showSearch={false} />
      <main>
        <section className="bg-[#F8F8F8]">
          <div className="mx-auto grid max-w-[1188px] gap-5 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
            <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#A61C20]">{eyebrow}</div>
            <h1 className="m-0 max-w-[980px] text-[34px] font-bold leading-tight text-[#22272F] sm:text-[48px]">{title}</h1>
            {subtitle ? <p className="m-0 max-w-[860px] text-[18px] leading-8 text-[#505A69]">{subtitle}</p> : null}
          </div>
        </section>

        <section className="mx-auto grid max-w-[1188px] gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          {children}
          {sections.length ? (
            <div className="grid gap-5">
              {sections.map((section) => (
                <article key={section.id || section.title} id={section.id} className="rounded border border-[#DEE5EC] bg-white p-5 shadow-sm">
                  <h2 className="m-0 text-[24px] font-bold text-[#22272F]">{section.title}</h2>
                  <div className="mt-3 text-[16px] leading-7 text-[#505A69]">{section.body}</div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
      <SwfiFooter />
    </div>
  );
}

export function SwfiButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={appHref(href)} className="inline-flex min-h-11 items-center justify-center rounded border border-[#A61C20] bg-[#A61C20] px-5 text-[15px] font-bold text-white no-underline hover:bg-[#8C0006]">
      {children}
    </a>
  );
}

export function SwfiTextInput({ label, name, type = "text", required = false }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <label className="grid gap-1 text-[14px] font-bold text-[#22272F]">
      {label}
      <input name={name} type={type} required={required} className="min-h-11 rounded border border-[#C8CFD7] px-3 text-[15px] font-normal outline-none focus:border-[#A61C20]" />
    </label>
  );
}

export function SwfiSelect({ label, name, options, required = false }: { label: string; name: string; options: readonly string[]; required?: boolean }) {
  return (
    <label className="grid gap-1 text-[14px] font-bold text-[#22272F]">
      {label}
      <select name={name} required={required} className="min-h-11 rounded border border-[#C8CFD7] bg-white px-3 text-[15px] font-normal outline-none focus:border-[#A61C20]">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function SwfiFooter() {
  return (
    <footer className="bg-[#22272F] px-4 py-8 text-white">
      <div className="mx-auto grid max-w-[1188px] gap-5">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="SWFI social links" className="flex flex-wrap items-center gap-6">
            <a href="https://twitter.com/swfinstitute?ref_src=twsrc%5Egoogle%7Ctwcamp%5Eserp%7Ctwgr%5Eauthor" aria-label="Twitter" className="inline-flex">
              <img src={assetHref("/swfi-assets/twitter.svg")} alt="" className="h-6 w-6" />
            </a>
            <a href="https://www.linkedin.com/company/sovereign-wealth-fund-institute-inc-" aria-label="LinkedIn" className="inline-flex">
              <img src={assetHref("/swfi-assets/linkedin.svg")} alt="" className="h-6 w-6" />
            </a>
            <a href="https://www.facebook.com/institutionalinvestorsSWFI/" aria-label="Facebook" className="inline-flex">
              <img src={assetHref("/swfi-assets/facebook.svg")} alt="" className="h-6 w-6" />
            </a>
          </nav>
          <nav aria-label="SWFI footer navigation" className="flex flex-wrap gap-8 text-[14px]">
          <a href={appHref("/about/")} className="text-white underline">About Us</a>
          <a href={appHref("/solutions/")} className="text-white underline">Solutions</a>
          <a href={appHref("/demo/")} className="text-white underline">Demo</a>
          <a href={appHref("/contact/")} className="text-white underline">Contact Us</a>
          <a href={appHref("/newsletter-subscription/")} className="text-white underline">Subscribe</a>
          <a href={appHref("/login/")} className="text-white underline">Sign In</a>
          </nav>
        </div>
        <div className="h-px bg-white/20" />
        <div className="flex flex-col gap-4 text-[13px] text-white/85 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <img src={assetHref("/swfi-assets/footer-logo.svg")} alt="" className="h-6 w-5" />
            <span>© 2008-2023 Sovereign Wealth Fund Institute | All rights reserved</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href={appHref("/privacy-policy/")} className="text-white/85 underline">Privacy Policy</a>
            <a href={appHref("/terms-of-use/")} className="text-white/85 underline">Terms of Use</a>
            <a href={appHref("/cookie-policy/")} className="text-white/85 underline">Cookie Policy</a>
            <a href={appHref("/accessibility/")} className="text-white/85 underline">Accessibility Statement</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
