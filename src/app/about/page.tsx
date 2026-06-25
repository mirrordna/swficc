import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { SwfiFooter } from "@/components/SwfiMarketingPage";
import SwfiTimeline from "@/components/SwfiTimeline";
import { swfiAboutOverview } from "@/lib/swfiSourceContent";
import { appHref, assetHref } from "@/lib/selfContainedLinks";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId="brand-about-search" showSearch={false} />
      <main className="mx-auto grid max-w-[1188px] gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#505A69]">
          <a href={appHref("/")} className="text-[#11314F] underline">SWFI</a>
          <span>/</span>
          <a href={appHref("/about/")} className="text-[#11314F] underline">About Us</a>
          <span>/</span>
          <span>Overview</span>
        </nav>
        <section className="grid max-w-[980px] gap-5">
          <h1 className="m-0 text-[32px] font-bold leading-tight text-[#22272F] sm:text-[42px]">{swfiAboutOverview.title}</h1>
        </section>
        <img src={assetHref("/swfi-assets/about-us-banner.svg")} alt="about-us-banner" className="h-auto w-full" />
        <section className="grid gap-5">
          <p className="m-0 text-[24px] leading-8 text-[#A61C20]">{swfiAboutOverview.subtitle}</p>
          <div className="grid gap-4 text-[16px] leading-7 text-[#505A69]">
            {swfiAboutOverview.paragraphs.map((paragraph) => <p key={paragraph} className="m-0">{paragraph}</p>)}
          </div>
          <SwfiTimeline entries={swfiAboutOverview.timeline} />
        </section>
      </main>
      <SwfiFooter />
    </div>
  );
}
