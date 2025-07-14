import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Only use static export for production builds
  ...(isDevelopment ? {} : { output: 'export' }),
  images: { unoptimized: true },
  trailingSlash: false,
  generateBuildId: async () => 'static-build'
};

export default nextConfig;
