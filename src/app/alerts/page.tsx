import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { appHref } from "@/lib/selfContainedLinks";

// Minutes F (2026-07-03): every element must have working function. Alerts
// previously rendered a list page wired to an EMPTY endpoint — a permanently
// blank table. Until a real alerts source exists, this page says so honestly
// and points to the closest live surfaces. The nav tab is removed.
export default function AlertsPage() {
  return (
    <>
      <SwfiBrandHeader showSearch={false} />
      <main className="mx-auto grid w-full max-w-[960px] gap-4 px-4 py-6 lg:px-[72px]">
        <section className="grid gap-3 border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Alerts</div>
          <h1 className="m-0 text-[24px] font-bold text-[#11314F]">Alerts are not available yet</h1>
          <p className="m-0 text-sm leading-6 text-[#41566B]">
            This preview does not have an alerts feed. For time-sensitive items today, use RFPs &amp; Mandates (deadlines) or Research &amp; Analytics (latest news) — or manage notifications in your account on swfi.com.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={appHref("/mandates/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              RFPs &amp; Mandates
            </a>
            <a href={appHref("/intelligence/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              Research &amp; Analytics
            </a>
            <a href="https://www.swfi.com/v1/signin/" className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              swfi.com account
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
