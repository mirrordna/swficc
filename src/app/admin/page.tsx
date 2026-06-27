import AdminApiKeyConsole from "@/components/AdminApiKeyConsole";
import AdminGovernanceConsole from "@/components/AdminGovernanceConsole";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";

export default function AdminPage() {
  return (
    <>
      <SwfiBrandHeader showSearch={false} />
      <main className="mx-auto grid w-full max-w-[1296px] gap-4 px-4 py-6 lg:px-[72px]">
        <AdminGovernanceConsole />
        <AdminApiKeyConsole />
      </main>
    </>
  );
}
