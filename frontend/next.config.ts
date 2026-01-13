import type { NextConfig } from 'next'

const isProd = process.env.NODE_ENV === 'production'
const nextConfig: NextConfig = {
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
    // 优化打包
    poweredByHeader: false,
    reactStrictMode: true,
    // 压缩优化
    compress: true
}
export default nextConfig
