import Link from 'next/link'

import { MODULE_REGISTRY } from '@/config/modules'
import { siteConfig } from '@/config/site'

/**
 * M0 占位首页
 *
 * 作用不是"好看"，而是当烟雾测试用：
 *   1. 验证 Tailwind v4 + 设计令牌生效（颜色、圆角、间距、断点）
 *   2. 验证深浅色主题切换
 *   3. 验证路径别名 @/* 生效
 *   4. 给出到设计稿与文档的入口，方便对照实现
 *
 * 真正的内容在 M3 按 docs/05-frontend-ia.md §4.1 实现。
 */
export default function HomePage() {
  const modules = Object.values(MODULE_REGISTRY).sort((a, b) => a.navOrder - b.navOrder)

  return (
    <div className="container-page py-16 md:py-24">
      {/* ---------- Hero ---------- */}
      <section className="container-prose text-center">
        <div className="from-brand mx-auto grid size-24 place-items-center rounded-[28px] bg-gradient-to-br to-[#a855f7] text-4xl font-bold text-white">
          P
        </div>
        <h1 className="mt-6 text-[30px] font-bold tracking-tight md:text-[42px]">
          {siteConfig.shortName}
        </h1>
        <p className="text-muted-foreground mt-2.5 text-base md:text-lg">
          {siteConfig.description}
        </p>
        <p className="text-muted-foreground border-brand-border mt-5 inline-block border-l-[3px] pl-4 text-left text-[15px]">
          「用工程化的方式，把想法变成能用的东西。」
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/portfolio"
            className="bg-primary text-primary-foreground hover:bg-brand-hover rounded-[10px] px-5 py-2.5 text-sm font-medium transition-colors"
          >
            看看我的作品
          </Link>
          <Link
            href="/articles"
            className="border-border-strong hover:bg-muted rounded-[10px] border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            读读我的文章
          </Link>
        </div>
      </section>

      {/* ---------- M0 自检 ---------- */}
      <section className="mt-16 md:mt-20">
        <div className="border-brand-border bg-brand-soft/40 rounded-xl border border-dashed p-5 md:p-6">
          <h2 className="text-brand text-sm font-semibold">✅ M0 骨架已就位</h2>
          <p className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">
            这一页是烟雾测试页。如果你看到以下内容正常，说明工程化配置是对的：
            紫色强调色、圆角卡片、中文排版、右下角主题切换（跟随系统）。
          </p>

          <div className="text-muted-foreground mt-4 grid gap-2 text-[13px] md:grid-cols-2">
            {[
              'Tailwind v4 + CSS 变量令牌生效',
              '深色模式 class 策略（next-themes）',
              '路径别名 @/* 生效',
              '三端断点 xs / md / lg 已定义',
              'ESLint 禁止 middleware 引入 Prisma',
              'Prettier + husky + commitlint 已配置',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <span className="text-success">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 模块占位 ---------- */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">模块骨架</h2>
        <p className="text-muted-foreground mt-1.5 text-sm">
          以下路由将在 M3 按设计稿实现。当前均为占位，点进去会看到 404 —— 那是预期行为。
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.key} className="bg-card shadow-card rounded-xl border p-4">
              <div className="flex items-center gap-2.5">
                <code className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 font-mono text-[11.5px]">
                  {m.route}
                </code>
                <span className="text-sm font-semibold">{m.name}</span>
                {!m.canDisable && (
                  <span className="bg-muted text-fg-subtle ml-auto rounded-full px-2 py-0.5 text-[10.5px]">
                    不可关闭
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
                {m.description}
              </p>
              <p className="text-fg-subtle mt-2 text-[11.5px]">
                类型开关：{Object.keys(m.defaultConfig.types ?? {}).join(' / ') || '—'}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 文档与设计稿入口 ---------- */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">下一步看哪里</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="bg-card shadow-card rounded-xl border p-5">
            <div className="text-sm font-semibold">🎨 UI 设计稿</div>
            <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
              24 个页面 / 36 张设计图，评审看板在{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[12px]">
                design/index.html
              </code>
              ，用浏览器打开。
            </p>
          </div>
          <div className="bg-card shadow-card rounded-xl border p-5">
            <div className="text-sm font-semibold">📚 设计文档</div>
            <p className="text-muted-foreground mt-2 text-[13px] leading-relaxed">
              8 份文档在{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[12px]">docs/</code>
              ，从{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[12px]">
                README.md
              </code>{' '}
              的索引进入。下一步是 M1（数据层与鉴权）。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
