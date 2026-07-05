import type { Metadata } from "next";
import StaleCacheGuard from "@/components/StaleCacheGuard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sovereign Wealth Fund Institute",
  description: "SWFI institutional investor intelligence and capital activity dashboard.",
  icons: {
    icon: "/swficc/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Every final link hands off to www.swfi.com (minutes G/J). Measured
            2026-07-05: the first click paid ~0.9s of DNS+TCP+TLS setup to the
            far origin before the signin page even answered. Pre-establishing
            the connection while the user is still on the dashboard removes
            that setup cost from the first handoff. The remaining latency
            (signin TTFB ~1.2s, no CDN edge) is swfi.com-side. */}
        <link rel="preconnect" href="https://www.swfi.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.swfi.com" />
      </head>
      <body className="min-h-full flex flex-col bg-[#f5f7fa] text-gray-900 font-sans">
        <StaleCacheGuard />
        {children}
      </body>
    </html>
  );
}
