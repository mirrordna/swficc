import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { appHref } from "@/lib/selfContainedLinks";

export default function AccountPage() {
  return (
    <>
      <SwfiBrandHeader showSearch={false} />
      <main className="mx-auto grid w-full max-w-[960px] gap-4 px-4 py-6 lg:px-[72px]">
        <section className="grid gap-3 border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Account</div>
          <h1 className="m-0 text-[24px] font-bold text-[#11314F]">SWFI Account</h1>
          <p className="m-0 text-sm leading-6 text-[#41566B]">
            Account access is handled by the SWFI sign-in flow. After sign-in, SWFI returns users to the requested SWFIPN route when the session bridge is enabled.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={appHref("/login/?next=/swficc/account/")} className="border border-[#A61C20] bg-[#A61C20] px-3 py-2 font-semibold text-white no-underline">
              Sign In
            </a>
            <a href={appHref("/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              Return to Dashboard
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
