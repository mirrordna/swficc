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
            Accounts live on the SWFI platform — this dashboard is a preview and has no account of its own. Sign in on swfi.com to manage your subscription, profile, and access.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            {/* Minutes F/G + source-of-truth rule: the old button targeted an
                in-app /login route that does not exist (404). Sign-in belongs
                to swfi.com. */}
            <a href="https://www.swfi.com/v1/signin/" className="border border-[#A61C20] bg-[#A61C20] px-3 py-2 font-semibold text-white no-underline">
              Sign In on SWFI
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
