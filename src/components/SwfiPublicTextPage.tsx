import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { SwfiFooter } from "@/components/SwfiMarketingPage";
import type { SwfiPublicPageId } from "@/lib/swfiPublicPageContent";
import { swfiPublicPages } from "@/lib/swfiPublicPageContent";

function bodyWithoutTitle(text: string, title: string) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  return clean.startsWith(title) ? clean.slice(title.length).replace(/^\n+/, "") : clean;
}

export default function SwfiPublicTextPage({ pageId }: { pageId: SwfiPublicPageId }) {
  const page = swfiPublicPages[pageId];
  const body = bodyWithoutTitle(page.text, page.title);

  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId={`brand-${pageId}-search`} showSearch={false} />
      <main className="mx-auto max-w-[980px] px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="m-0 text-[34px] font-bold leading-tight text-[#22272F] sm:text-[44px]">{page.title}</h1>
        {pageId === "newsletter" ? (
          <form action="/swficc/newsletter-subscription/" method="get" className="mt-8 grid max-w-[520px] gap-3">
            <label className="grid gap-2 text-[14px] font-bold text-[#22272F]">
              Email
              <input id="email" name="email" type="text" className="min-h-11 rounded border border-[#C8CFD7] px-3 text-[15px] font-normal outline-none focus:border-[#A61C20]" />
            </label>
            <button type="submit" className="min-h-11 w-fit rounded border border-[#A61C20] bg-[#A61C20] px-6 text-[15px] font-bold text-white">
              Subscribe
            </button>
          </form>
        ) : (
          <div className="mt-8 whitespace-pre-wrap text-[16px] leading-8 text-[#3D4652]">{body}</div>
        )}
      </main>
      <SwfiFooter />
    </div>
  );
}
