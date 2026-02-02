import type { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'
const nextConfig: NextConfig = {
    basePath: '/chatai',
    output: 'export',
    distDir: 'out',
    trailingSlash: true,
    images: {
        unoptimized: true
    },
    productionBrowserSourceMaps: !isProd,
    compiler: {
        removeConsole: isProd ? { exclude: ['error', 'warn'] } : false
    },
    experimental: {
        optimizeCss: true
    },
    poweredByHeader: false,
    reactStrictMode: true,
    compress: true
}
export default nextConfig
