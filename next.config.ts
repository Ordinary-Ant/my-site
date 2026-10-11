import type { NextConfig } from 'next'

/**
 * 安全响应头
 * 见 docs/01-architecture.md §9
 *
 * ⚠ 'unsafe-inline' 是必需的：
 *   1. Next.js 会内联一部分启动脚本
 *   2. 动效系统通过内联 <style> 注入 CSS 变量（见 docs/08-motion-system.md §9）
 * 后续若要用 nonce 收紧，需要同时改掉动效注入方式。
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // 后台 / API 不参与静态优化，避免被 CDN 缓存
  // （per-route 的 Cache-Control 在 Route Handler 内设置）

  images: {
    formats: ['image/avif', 'image/webp'],
    // 生产环境把对象存储域名加进来，例如：
    // remotePatterns: [{ protocol: 'https', hostname: 'cdn.example.com' }],
    remotePatterns: [],
  },

  async headers() {
    return [
      {
        // 全局规则先应用，预览的更严格策略随后覆盖同名响应头。
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // 后台一律禁止索引
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // 登录页同样禁止索引
        source: '/login',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/preview/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}

export default nextConfig
