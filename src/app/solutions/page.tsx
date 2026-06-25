import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { SwfiButton, SwfiFooter } from "@/components/SwfiMarketingPage";
import { appHref, assetHref } from "@/lib/selfContainedLinks";
import { swfiSolutionSections } from "@/lib/swfiSourceContent";

export default function SolutionsPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId="brand-solutions-search" showSearch={false} />
      <main className="mx-auto grid max-w-[1296px] gap-10 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#505A69]">
          <a href={appHref("/")} className="text-[#11314F] underline">SWFI</a>
          <span>/</span>
          <a href={appHref("/solutions/")} className="text-[#11314F] underline">Solutions</a>
          <span>/</span>
          <span>Fundraising & Finding Buyers</span>
        </nav>
        {swfiSolutionSections.map((section) => (
          <section key={section.id} id={section.id} className="grid gap-6">
            <img src={assetHref(section.image)} alt="solution" className="h-auto w-full" />
            <div className="grid gap-4">
              <h1 className="m-0 text-[32px] font-bold leading-tight text-[#22272F] sm:text-[42px]">{section.title}</h1>
              <p className="m-0 text-[16px] leading-7 text-[#505A69]">{section.description}</p>
              {"secondaryDescription" in section && section.secondaryDescription ? <p className="m-0 text-[16px] leading-7 text-[#505A69]">{section.secondaryDescription}</p> : null}
              {section.blocks.map((block) => (
                <div key={block.title} className="grid gap-2">
                  <h2 className="m-0 text-[22px] font-bold text-[#22272F]">{block.title}</h2>
                  {block.paragraphs.map((paragraph) => <p key={paragraph} className="m-0 text-[16px] leading-7 text-[#505A69]">{paragraph}</p>)}
                </div>
              ))}
              <div><SwfiButton href="/demo/">Request a demo</SwfiButton></div>
            </div>
          </section>
        ))}
      </main>
      <SwfiFooter />
    </div>
  );
}
