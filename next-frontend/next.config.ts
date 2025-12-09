import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静态导出模式 - 可以像 Vue 一样部署到任何静态服务器
  output: 'export',
  
  // 构建输出目录
  distDir: 'out',
  
  // 禁用图片优化（静态导出不支持）
  images: {
    unoptimized: true,
  },
  
  // 尾部斜杠（可选，根据后端路由需要）
  trailingSlash: true,
  
  // 基础路径（如果部署在子目录，如 /admin）
  // basePath: '/admin',
};

export default nextConfig;
