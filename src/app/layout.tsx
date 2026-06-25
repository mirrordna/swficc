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
      <body className="min-h-full flex flex-col bg-[#f5f7fa] text-gray-900 font-sans">
        <StaleCacheGuard />
        {children}
      </body>
    </html>
  );
}
