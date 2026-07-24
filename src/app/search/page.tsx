import { Suspense } from "react";
import SearchResultsPage from "@/components/SearchResultsPage";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchRouteLoadingFallback />}>
      <SearchResultsPage />
    </Suspense>
  );
}

function SearchRouteLoadingFallback() {
  return (
    <div className="min-h-screen bg-[#F2F4F6] font-sans text-[#1B2733]">
      <main className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]">
        <section
          className="rounded border border-[#DCE3EA] bg-white p-4"
          data-testid="search-route-loading-fallback"
        >
          <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Smart Search</h1>
          <p className="m-0 mt-2 text-[13px] text-[#526171]" role="status">Loading search…</p>
        </section>
      </main>
    </div>
  );
}
