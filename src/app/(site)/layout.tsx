import Link from 'next/link'

import { MODULE_REGISTRY } from '@/config/modules'
import { siteConfig } from '@/config/site'

/**
 * 前台路由组布局
 *
 * M0 阶段先搭出 Header / Footer 骨架，真实内容在 M3 补齐。
 * 导航项最终由 moduleService.listVisible() 动态生成（M2 之后接入），
 * 现在先用静态注册表，保证骨架可跑。
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const navItems = Object.values(MODULE_REGISTRY)
    .filter((m) => m.navVisible && m.key !== 'home')
    .sort((a, b) => a.navOrder - b.navOrder)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="container-page flex h-16 items-center gap-7">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="from-brand grid size-7 place-items-center rounded-lg bg-gradient-to-br to-[#a855f7] text-[13px] font-bold text-white">
              P
            </span>
            {siteConfig.shortName}
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {navItems.map((m) => (
              <Link
                key={m.key}
                href={m.route}
                className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              >
                {m.name}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-surface-subtle mt-10 border-t">
        <div className="container-page py-10">
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-4 text-[13px]">
            <span>© {new Date().getFullYear()} {siteConfig.author.name} · 保留所有权利</span>
            <span className="text-fg-subtle">M0 骨架 · 内容待 M3 补齐</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
