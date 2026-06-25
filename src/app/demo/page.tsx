import { SwfiMarketingPage, SwfiSelect, SwfiTextInput } from "@/components/SwfiMarketingPage";
import { swfiBusinessTypes, swfiCountries, swfiDemoReasons } from "@/lib/swfiSourceContent";

export default function DemoPage() {
  return (
    <SwfiMarketingPage
      eyebrow="Demo"
      title="Request a Demo"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <form className="grid gap-4 rounded border border-[#DEE5EC] bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <SwfiTextInput label="First name" name="firstName" required />
            <SwfiTextInput label="Last name" name="lastName" required />
            <SwfiTextInput label="Job title" name="jobTitle" required />
            <SwfiTextInput label="Company name" name="companyName" required />
            <SwfiSelect label="Business type" name="businessType" options={swfiBusinessTypes} required />
            <SwfiSelect label="Country" name="country" options={swfiCountries} required />
            <SwfiTextInput label="Phone Number" name="phone" type="tel" required />
            <SwfiTextInput label="Corporate email" name="email" type="email" required />
          </div>
          <div className="flex justify-center">
            <button type="button" className="min-h-11 rounded border border-[#A61C20] bg-[#A61C20] px-8 text-[15px] font-bold text-white">Submit</button>
          </div>
        </form>
        <aside className="grid gap-5 rounded border border-[#DEE5EC] bg-[#F8F8F8] p-5">
          <section className="grid gap-3">
            <h2 className="m-0 text-[24px] font-bold text-[#22272F]">Be Part of the Elite SWFI Community</h2>
            <p className="m-0 text-[15px] leading-7 text-[#505A69]">You&apos;re one step closer to getting access to the Asset Owner Platform. Fill out the form so we can connect you to the right person.</p>
          </section>
          <section>
            <h2 className="m-0 text-[20px] font-bold text-[#22272F]">Top 8 reasons people join SWFI</h2>
            <ol className="m-0 mt-3 grid gap-2 pl-5 text-[15px] leading-7 text-[#505A69]">
              {swfiDemoReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ol>
          </section>
        </aside>
      </div>
    </SwfiMarketingPage>
  );
}
