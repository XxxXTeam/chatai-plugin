import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'out',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  productionBrowserSourceMaps: false,
  turbopack: {},

  experimental: {
    optimizeCss: true,
    parallelServerCompiles: true,
    parallelServerBuildTraces: true,
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  generateBuildId: async () => {
    return 'build-' + Date.now().toString(36);
  },
};

export default nextConfig;
