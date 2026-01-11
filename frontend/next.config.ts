import type { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'
const nextConfig: NextConfig = {
    output: 'export',
    distDir: 'out',
    trailingSlash: true,
    images: {
        unoptimized: true
    },
    productionBrowserSourceMaps: true,
    compiler: {
        removeConsole: isProd ? { exclude: ['error', 'warn'] } : false
    },
    experimental: {
        optimizeCss: true
    }
}
export default nextConfig
