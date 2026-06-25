import { SwfiMarketingPage, SwfiSelect, SwfiTextInput } from "@/components/SwfiMarketingPage";
import { swfiCountries, swfiReferralSources } from "@/lib/swfiSourceContent";

export default function ContactPage() {
  return (
    <SwfiMarketingPage
      eyebrow="Contact Us"
      title="Contact Us"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <form className="grid gap-4 rounded border border-[#DEE5EC] bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <SwfiTextInput label="Name" name="name" required />
            <SwfiTextInput label="Email" name="email" type="email" required />
            <SwfiSelect label="Country" name="country" options={swfiCountries} required />
            <SwfiTextInput label="Phone Number" name="phone" type="tel" required />
          </div>
          <SwfiSelect label="How did you find us?" name="referral" options={swfiReferralSources} required />
          <div className="flex justify-center">
            <button type="button" className="min-h-11 rounded border border-[#A61C20] bg-[#A61C20] px-8 text-[15px] font-bold text-white">Submit</button>
          </div>
        </form>

        <aside className="grid gap-5 rounded border border-[#DEE5EC] bg-[#F8F8F8] p-5">
          <section>
            <h2 className="m-0 text-[22px] font-bold text-[#22272F]">Corporate offices</h2>
            <div className="mt-3 grid gap-3 text-[15px] leading-7 text-[#505A69]">
              <p className="m-0">2300 West Sahara Avenue Suite 800<br />Las Vegas, NV, 89102 United States</p>
              <p className="m-0">One Cowboys Way Suite 270<br />Frisco, TX, 75034 United States</p>
            </div>
          </section>
          <section>
            <h2 className="m-0 text-[22px] font-bold text-[#22272F]">Email</h2>
            <div className="mt-3 grid gap-2 text-[15px]">
              <a href="mailto:support@swfinstitute.org" className="text-[#A61C20] underline">support@swfinstitute.org</a>
              <a href="mailto:events@swfinstitute.org" className="text-[#A61C20] underline">events@swfinstitute.org</a>
            </div>
          </section>
        </aside>
      </div>
    </SwfiMarketingPage>
  );
}
