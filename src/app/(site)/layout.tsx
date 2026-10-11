import Link from 'next/link'
import Image from 'next/image'
import { getPublicSite } from '@/lib/services/public-site'
import { safeContentUrl } from '@/lib/markdown'
import { SiteNavigation } from '@/components/site/navigation'
import { MotionSurface } from '@/components/site/motion-surface'
export const dynamic = 'force-dynamic'
/** 页脚与导航复用已过滤的公开配置，不另读私密联系方式。 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const data = await getPublicSite()
  const name = data.site.name || '个人网站'
  const logo = typeof data.site.logo === 'string' ? safeContentUrl(data.site.logo) : null
  const links = Array.isArray(data.site.footer.links)
    ? (data.site.footer.links as { label?: string; url?: string | null }[])
    : []
  return (
    <MotionSurface config={data.motion}>
      <div className="flex min-h-dvh flex-col">
        <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur-md">
          <div className="container-page flex h-16 items-center gap-4">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-semibold"
              aria-label={name + '首页'}
            >
              {logo ? (
                <Image
                  unoptimized
                  src={logo}
                  width={30}
                  height={30}
                  alt=""
                  className="rounded-lg"
                />
              ) : (
                <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg">
                  P
                </span>
              )}
              <span className="max-w-32 truncate">{name}</span>
            </Link>
            <SiteNavigation items={data.modules} />
          </div>
        </header>
        {/* 底部导航必须离开带backdrop-filter的header，才能固定于视口。 */}
        <SiteNavigation items={data.modules} placement="bottom" />
        <main className="flex-1">{children}</main>
        <footer className="bg-surface-subtle mt-16 border-t">
          <div className="container-page py-10">
            <div className="grid gap-8 text-sm md:grid-cols-3">
              <div>
                <Link href="/" className="text-base font-semibold">
                  {name}
                </Link>
                <p className="text-muted-foreground mt-3 leading-relaxed">
                  {data.site.description}
                </p>
              </div>
              <div>
                <h2 className="font-semibold">导航</h2>
                <nav aria-label="页脚导航" className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {data.modules
                    .filter((m) => m.navVisible && m.key !== 'home')
                    .map((m) => (
                      <Link key={m.key} href={m.route}>
                        {m.navLabel || m.name}
                      </Link>
                    ))}
                </nav>
              </div>
              <div>
                <h2 className="font-semibold">找到我</h2>
                <div className="mt-3 flex flex-wrap gap-3">
                  {Object.entries(data.site.social).map(([key, value]) => {
                    if (typeof value !== 'string' || !value) return null
                    const url =
                      key === 'email'
                        ? 'mailto:' + value
                        : key === 'phone'
                          ? 'tel:' + value
                          : safeContentUrl(value)
                    return url ? (
                      <a key={key} href={url} rel="noopener noreferrer" className="text-brand">
                        {(
                          {
                            github: 'GitHub',
                            email: '邮箱',
                            phone: '电话',
                            twitter: 'X',
                            juejin: '掘金',
                          } as Record<string, string>
                        )[key] ?? key}
                      </a>
                    ) : null
                  })}
                  {data.modules.some((m) => ['article', 'log'].includes(m.key)) && (
                    <Link href="/rss.xml">RSS订阅</Link>
                  )}
                </div>
              </div>
            </div>
            {!!links.length && (
              <nav aria-label="页脚附加链接" className="mt-6 flex flex-wrap gap-4 text-sm">
                {links.map((link, index) => {
                  const url = safeContentUrl(link.url)
                  return url ? (
                    <a key={index} href={url} rel="noopener noreferrer">
                      {link.label || '链接'}
                    </a>
                  ) : null
                })}
              </nav>
            )}
            <div className="text-muted-foreground mt-8 flex flex-wrap justify-between gap-4 border-t pt-6 text-xs">
              <span>
                {String(
                  data.site.footer.copyright ??
                    '© ' + new Date().getFullYear() + ' ' + name + ' · 保留所有权利',
                )}
              </span>
              {!!data.site.footer.icp && (
                <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
                  {String(data.site.footer.icp)}
                </a>
              )}
            </div>
          </div>
        </footer>
      </div>
    </MotionSurface>
  )
}
