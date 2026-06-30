import AdminApiKeyConsole from "@/components/AdminApiKeyConsole";
import AdminGovernanceConsole from "@/components/AdminGovernanceConsole";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { appHref } from "@/lib/selfContainedLinks";

export default function AdminPage() {
  return (
    <>
      <SwfiBrandHeader showSearch={false} />
      <main className="mx-auto grid w-full max-w-[1296px] gap-4 px-4 py-6 lg:px-[72px]">
        <section className="grid gap-3 border border-[#DCE3EA] bg-white px-4 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Admin Workflows</div>
            <h1 className="m-0 mt-1 text-[24px] font-bold text-[#11314F]">SWFIPN Admin Console</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={appHref("/admin/enrichment/people/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              People Enrichment Review
            </a>
          </div>
        </section>
        <AdminGovernanceConsole />
        <AdminApiKeyConsole />
      </main>
    </>
  );
}
