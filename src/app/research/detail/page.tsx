import SwfiPlatformRedirect from "@/components/SwfiPlatformRedirect";

// Minutes 2026-07-03 decision J: detail views forward to the SWFI platform.
export default function Page() {
  return <SwfiPlatformRedirect kind="research" />;
}
