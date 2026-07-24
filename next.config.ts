import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/swficc",
  trailingSlash: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  images: { unoptimized: true },
};

export default nextConfig;
