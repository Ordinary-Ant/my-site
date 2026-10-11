import type { CSSProperties } from 'react'
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { siteConfig } from '@/config/site'
import { getPublicSite } from '@/lib/services/public-site'
import { safeContentUrl } from '@/lib/markdown'
import './globals.css'

// 主题与metadata来自后台配置，每次新请求读取，避免登录等系统页固化构建时配置。
export const dynamic = 'force-dynamic'

/** metadata复用公共配置边界，联系方式关闭后不从原表重新拼SEO。 */
export async function generateMetadata(): Promise<Metadata> {
  const data = await getPublicSite()
  const name = data.site.name || '个人网站'
  const title =
    typeof data.seo.defaultTitle === 'string' && data.seo.defaultTitle
      ? data.seo.defaultTitle
      : name
  const description =
    typeof data.seo.defaultDescription === 'string'
      ? data.seo.defaultDescription
      : data.site.description
  const og = typeof data.seo.ogImage === 'string' ? safeContentUrl(data.seo.ogImage) : null
  const icon = typeof data.site.favicon === 'string' ? safeContentUrl(data.site.favicon) : null
  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: title, template: '%s · ' + name },
    description,
    applicationName: name,
    authors: typeof data.profile?.name === 'string' ? [{ name: data.profile.name }] : undefined,
    creator: typeof data.profile?.name === 'string' ? data.profile.name : undefined,
    keywords: typeof data.seo.keywords === 'string' ? data.seo.keywords : undefined,
    formatDetection: { telephone: false, email: false, address: false },
    icons: icon ? { icon } : undefined,
    openGraph: {
      type: 'website',
      locale: data.site.locale.replace('-', '_'),
      url: siteConfig.url,
      siteName: name,
      title,
      description,
      images: [og || '/api/v1/og'],
    },
    twitter: { card: 'summary_large_image' },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
  }
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await getPublicSite()
  const accent =
    typeof data.theme.accent === 'string' && /^#[a-f0-9]{6}$/i.test(data.theme.accent)
      ? data.theme.accent
      : undefined
  const defaultTheme = ['system', 'light', 'dark'].includes(String(data.site.defaultTheme))
    ? String(data.site.defaultTheme)
    : 'system'
  return (
    <html lang={data.site.locale || 'zh-CN'} suppressHydrationWarning>
      <body
        className="bg-background text-foreground min-h-dvh antialiased"
        style={accent ? ({ '--brand': accent, '--primary': accent } as CSSProperties) : undefined}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme={defaultTheme}
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
