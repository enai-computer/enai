import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  generateBuildId: async () => 'static-build'
};

export default nextConfig;
