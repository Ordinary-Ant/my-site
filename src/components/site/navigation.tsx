'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
type Item = { key: string; route: string; navLabel: string; name: string; navVisible: boolean }
/** 导航读取公开模块DTO，移动菜单用原生details，禁JS仍可访问。 */
export function SiteNavigation({ items }: { items: Item[] }) {
  const path = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const active = (route: string) =>
    route === '/' ? path === '/' : path === route || path.startsWith(route + '/')
  const visible = items.filter((item) => item.key !== 'home' && item.navVisible)
  const tabs = [
    { key: 'home', route: '/', navLabel: '首页', name: '首页', navVisible: true },
    ...visible.filter((item) => ['log', 'portfolio', 'article'].includes(item.key)),
  ]
  const theme = (
    <button
      type="button"
      aria-label="切换深浅主题"
      className="rounded-lg border px-3 py-2 text-sm"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {ready && resolvedTheme === 'dark' ? '☀' : '☾'}
    </button>
  )
  return (
    <>
      <nav aria-label="顶部导航" className="ml-auto hidden items-center gap-1 md:flex">
        {visible.map((item) => (
          <Link
            key={item.key}
            href={item.route}
            aria-current={active(item.route) ? 'page' : undefined}
            className={
              'rounded-lg px-3 py-2 text-sm font-medium ' +
              (active(item.route)
                ? 'text-brand bg-brand-soft'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            {item.navLabel || item.name}
          </Link>
        ))}
        <Link href="/search" aria-label="站内搜索" className="px-3 py-2 text-sm">
          搜索
        </Link>
        {theme}
      </nav>
      <details className="relative ml-auto md:hidden">
        <summary
          className="cursor-pointer rounded-lg border px-3 py-2 text-sm"
          aria-label="打开全部导航"
        >
          ☰ 菜单
        </summary>
        <nav
          aria-label="移动全部导航"
          className="bg-background shadow-card absolute right-0 mt-2 grid w-56 gap-2 rounded-xl border p-4"
        >
          <Link href="/">首页</Link>
          {visible.map((item) => (
            <Link
              key={item.key}
              href={item.route}
              aria-current={active(item.route) ? 'page' : undefined}
              className="py-1"
            >
              {item.navLabel || item.name}
            </Link>
          ))}
          <Link href="/search">站内搜索</Link>
          {theme}
        </nav>
      </details>
      <nav
        aria-label="移动底部导航"
        className="bg-background/95 pb-safe fixed inset-x-0 bottom-0 z-40 flex justify-around border-t backdrop-blur-md md:hidden"
      >
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.route}
            aria-current={active(item.route) ? 'page' : undefined}
            className={
              'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-2 text-xs font-medium ' +
              (active(item.route) ? 'text-brand bg-brand-soft' : 'text-muted-foreground')
            }
          >
            <span aria-hidden="true" className="text-base">
              {
                ({ home: '⌂', log: '▤', portfolio: '▦', article: '▧' } as Record<string, string>)[
                  item.key
                ]
              }
            </span>
            {item.navLabel || item.name}
          </Link>
        ))}
      </nav>
    </>
  )
}
