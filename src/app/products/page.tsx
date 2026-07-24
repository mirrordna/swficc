import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { SwfiButton, SwfiFooter } from "@/components/SwfiMarketingPage";
import { appHref } from "@/lib/selfContainedLinks";

const modules = [
  ["Allocator profiles", "Sovereign wealth funds, pensions, endowments, family offices, and institutional investors."],
  ["Transactions", "Deal records, counterparties, disclosed amounts, sectors, geography, and source routes."],
  ["Compass / RFPs", "Mandates and procurement opportunities with due dates and institution context."],
  ["People intelligence", "Approved executives, board changes, contacts, and relationship context where available."],
  ["Research & news", "Market developments, policy shifts, reports, and institution-level intelligence."],
  ["Exports", "PDF, Word, Excel, and chart outputs backed by the same approved record trail."],
] as const;

const workflows = [
  ["Find allocators", "Screen investors by type, region, AUM, sector activity, and mandate signals."],
  ["Analyze activity", "Move from dashboard signal to transaction, mandate, profile, person, or report detail."],
  ["Prepare outreach", "Create investor briefs from approved records without adding unsupported claims."],
] as const;

export default function ProductsPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId="brand-products-search" showSearch={false} />
      <main>
        <section className="overflow-hidden bg-[#001A31] text-white">
          <div className="relative mx-auto grid min-h-[660px] max-w-[1320px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,0.86fr)_minmax(540px,1fr)] lg:px-8 lg:py-16">
            <BrandArcs />
            <div className="relative z-10 grid content-center gap-6">
              <div className="h-px w-full bg-[#0B5AA4]" />
              <div className="grid gap-4">
                <p className="m-0 text-[13px] font-bold uppercase tracking-[0.16em] text-[#F3AB00]">SWFI Products</p>
                <h1 className="m-0 max-w-[620px] text-[46px] font-light leading-[1.02] tracking-[-0.01em] text-white sm:text-[64px]">
                  Capital Intelligence OS
                </h1>
                <p className="m-0 max-w-[620px] text-[19px] leading-8 text-[#C8CFD7]">
                  A workspace for allocator discovery, transaction intelligence, mandates, people, research, and institutional capital-flow analysis.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href={appHref("/")} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#A61C20] px-7 text-[15px] font-bold text-white no-underline hover:bg-[#8C0006]">
                  Open the dashboard
                </a>
                <SwfiButton href="/demo/">Request a demo</SwfiButton>
              </div>
              <div className="grid gap-3 pt-2 text-[13px] leading-6 text-[#DEE5EC] sm:grid-cols-3">
                {workflows.map(([title, body]) => (
                  <article key={title} className="border-l-2 border-[#F3AB00] pl-4">
                    <h2 className="m-0 text-[14px] font-bold text-white">{title}</h2>
                    <p className="m-0 mt-1">{body}</p>
                  </article>
                ))}
              </div>
            </div>
            <div className="relative z-10 grid content-center">
              <ProductMockup />
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid gap-3">
            <p className="m-0 text-[12px] font-bold uppercase tracking-[0.16em] text-[#A61C20]">One workspace, many record classes</p>
            <h2 className="m-0 max-w-[860px] text-[34px] font-bold leading-tight text-[#22272F] sm:text-[44px]">
              Bring related institutional information into a single, cohesive view.
            </h2>
            <p className="m-0 max-w-[860px] text-[17px] leading-8 text-[#505A69]">
              Each module is designed to route users from a high-level signal to the approved SWFI record behind it. Unsupported values stay out of the buyer-facing surface.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map(([title, body]) => (
              <article key={title} className="border border-[#DEE5EC] bg-[#F8F8F8] p-5">
                <h3 className="m-0 text-[19px] font-bold text-[#22272F]">{title}</h3>
                <p className="m-0 mt-3 text-[15px] leading-7 text-[#505A69]">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-[#F8F8F8]">
          <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[0.85fr_1fr] lg:px-8 lg:py-16">
            <div>
              <p className="m-0 text-[12px] font-bold uppercase tracking-[0.16em] text-[#A61C20]">Governed intelligence</p>
              <h2 className="m-0 mt-3 text-[32px] font-bold leading-tight text-[#22272F]">Professional polish without unsupported claims.</h2>
            </div>
            <div className="grid gap-4 text-[16px] leading-8 text-[#505A69]">
              <p className="m-0">
                The product experience should feel commercially strong, but the trust model remains strict: facts come from approved SWFI records, generated briefs summarize supplied source packets, and every displayed route should lead to a profile, transaction, mandate, person, report, or authenticated handoff.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-[#C8D1E5] bg-white p-4">
                  <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#70798B]">Allowed</div>
                  <div className="mt-2 text-[18px] font-bold text-[#22272F]">Approved SWFI records</div>
                </div>
                <div className="border border-[#C8D1E5] bg-white p-4">
                  <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#70798B]">Blocked</div>
                  <div className="mt-2 text-[18px] font-bold text-[#22272F]">Fallback or invented values</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SwfiFooter />
    </div>
  );
}

function ProductMockup() {
  return (
    <div className="relative mx-auto w-full max-w-[720px]">
      <div className="rounded-t-lg border border-[#8F9BAB] bg-[#22272F] px-5 py-3">
        <div className="flex gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#C8CFD7]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#C8CFD7]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#C8CFD7]" />
        </div>
      </div>
      <div className="grid min-h-[360px] grid-cols-[76px_minmax(0,1fr)] border-x border-b border-[#8F9BAB] bg-white shadow-[0_28px_70px_rgba(0,0,0,0.28)]">
        <aside className="bg-[#A61C20]" />
        <div className="grid gap-5 p-7 text-[#22272F]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-[28px] font-bold">SWFI</div>
              <div className="text-[13px] font-semibold text-[#718095]">Capital Intelligence</div>
            </div>
            <div className="h-9 w-[220px] rounded bg-[#E8EDF1]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Profiles", "Mandates", "Transactions"].map((label, index) => (
              <div key={label} className="border border-[#DEE5EC] bg-[#F8F8F8] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A61C20]">{label}</div>
                <div className="mt-4 h-2 rounded bg-[#C8D1E5]" />
                <div className={`mt-3 h-2 rounded ${index === 1 ? "w-3/4 bg-[#F3AB00]" : "w-2/3 bg-[#004483]"}`} />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
            <div className="border border-[#DEE5EC] bg-white p-5">
              <div className="mb-4 text-[15px] font-bold">Allocator league table</div>
              {["Norway Government Pension Fund Global", "SAFE Investment Company", "China Investment Corporation"].map((row, index) => (
                <div key={row} className="grid grid-cols-[1fr_120px] items-center border-t border-[#E8EDF1] py-3 first:border-t-0">
                  <span className="truncate text-[14px] font-semibold">{row}</span>
                  <span className={`h-2 rounded bg-[#F3AB00] ${index === 0 ? "w-full" : index === 1 ? "w-5/6" : "w-2/3"}`} />
                </div>
              ))}
            </div>
            <div className="border border-[#DEE5EC] bg-white p-5">
              <div className="mb-4 text-[15px] font-bold">Capital flow signal</div>
              <div className="flex h-[120px] items-end gap-2">
                {[42, 64, 55, 88, 74, 104, 94].map((height, index) => (
                  <span key={index} className="w-full bg-[#69A7E0]" style={{ height }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-8 right-4 hidden w-[180px] rounded-[28px] bg-[#3F4651] p-3 shadow-[0_20px_45px_rgba(0,0,0,0.35)] sm:block">
        <div className="rounded-[22px] bg-white px-5 py-7 text-[#22272F]">
          <div className="text-[20px] font-bold text-[#A61C20]">SWFI</div>
          <div className="mt-8 text-[21px] font-bold">Highlights</div>
          <div className="mt-4 grid gap-3">
            {["Profiles", "RFPs", "Deals"].map((label, index) => (
              <div key={label} className="rounded bg-[#F8F8F8] p-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#718095]">{label}</div>
                <div className="mt-2 flex h-10 items-end gap-1">
                  {[12, 20, 15, 28, 22].map((h, i) => <span key={`${index}-${i}`} className="w-full bg-[#F3AB00]" style={{ height: h }} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandArcs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-[-120px] hidden w-[620px] opacity-45 lg:block">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="absolute rounded-full border-[22px] border-[#0B5AA4]"
          style={{
            inset: `${item * 54 + 32}px ${item * 42}px ${item * 54 + 32}px ${item * 42}px`,
            borderLeftColor: "transparent",
            borderBottomColor: "transparent",
          }}
        />
      ))}
    </div>
  );
}
