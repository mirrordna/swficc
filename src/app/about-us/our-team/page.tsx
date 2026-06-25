import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { SwfiFooter } from "@/components/SwfiMarketingPage";
import { appHref, assetHref } from "@/lib/selfContainedLinks";
import { swfiTeamMembers } from "@/lib/swfiSourceContent";

export default function OurTeamPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-[#22272F]">
      <SwfiBrandHeader searchId="brand-team-search" showSearch={false} />
      <main className="mx-auto grid max-w-[1188px] gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#505A69]">
          <a href={appHref("/")} className="text-[#11314F] underline">SWFI</a>
          <span>/</span>
          <a href={appHref("/about/")} className="text-[#11314F] underline">About Us</a>
          <span>/</span>
          <span>Our Team</span>
        </nav>
        <h1 className="m-0 text-[32px] font-bold leading-tight text-[#22272F] sm:text-[42px]">Our Team</h1>
        <div className="grid gap-10">
          {swfiTeamMembers.map((member) => (
            <article key={member.name} className="grid gap-5 md:grid-cols-[264px_minmax(0,1fr)] md:items-start">
              <img src={assetHref(member.image)} alt={member.name} className="h-[264px] w-[264px] object-cover" />
              <div className="grid gap-3">
                <div>
                  <h2 className="m-0 text-[24px] font-bold text-[#22272F]">{member.name}</h2>
                  <p className="m-0 mt-1 text-[16px] font-semibold text-[#505A69]">{member.title}</p>
                </div>
                <div className="grid gap-3 text-[16px] leading-7 text-[#505A69]">
                  {member.paragraphs.map((paragraph) => <p key={paragraph} className="m-0">{paragraph}</p>)}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
      <SwfiFooter />
    </div>
  );
}
