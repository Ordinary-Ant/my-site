/* eslint-disable @next/next/no-html-link-for-pages -- 错误恢复需要整页刷新，重新读取公共数据。 */
import Link from 'next/link'
import Image from 'next/image'
import { getHomeFeed, getPublicSite } from '@/lib/services/public-site'
import { safeContentUrl } from '@/lib/markdown'
import { formatDate, excerpt } from '@/lib/utils'
import { format } from 'date-fns'
type Item = {
  id: string
  title?: string
  name?: string
  slug?: string
  summary?: string | null
  subtitle?: string | null
  description?: string | null
  coverImage?: string | null
  type?: string
  techStack?: string[]
  publishedAt?: string | Date
  logDate?: string | Date
  readingTime?: number
  organization?: string | null
  startDate?: string | Date
  endDate?: string | Date | null
  isCurrent?: boolean
  startPrecision?: string
  endPrecision?: string
}
function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}
function cover(value: unknown) {
  const url = typeof value === 'string' ? safeContentUrl(value) : null
  return url ? (
    <Image
      unoptimized
      src={url}
      alt=""
      width={640}
      height={360}
      className="bg-muted aspect-video w-full object-cover"
    />
  ) : (
    <div
      aria-hidden="true"
      className="bg-brand-soft text-brand flex aspect-video items-center justify-center text-4xl"
    >
      ✧
    </div>
  )
}
const precision = (value?: string) =>
  value === 'YEAR' ? 'yyyy' : value === 'MONTH' ? 'yyyy.MM' : 'yyyy.MM.dd'
const displayDate = (value: string | Date, pattern: string) => format(new Date(value), pattern)
/** 首页只拼装经过发布、类型开关和联系信息过滤的真实内容。 */
export default async function HomePage() {
  const [feed, site] = await Promise.all([getHomeFeed(), getPublicSite()])
  const p = feed.profile
  const sections = feed.sections.filter((s) => s.items.length > 0)
  const article = site.modules.find((m) => m.key === 'article')
  const portfolio = site.modules.find((m) => m.key === 'portfolio')
  const avatar = typeof p?.avatar === 'string' ? safeContentUrl(p.avatar) : null
  const socials = Array.isArray(p?.socials)
    ? (p.socials as { label?: string; platform?: string; url?: string }[])
    : []
  return (
    <div>
      <section className="container-page py-16 text-center md:py-24" data-motion="hero">
        {avatar ? (
          <Image
            unoptimized
            src={avatar}
            alt=""
            width={88}
            height={88}
            priority
            className="mx-auto rounded-full"
          />
        ) : (
          <span className="bg-brand-soft text-brand mx-auto grid size-24 place-items-center rounded-[28px] text-4xl font-semibold">
            P
          </span>
        )}
        <p className="text-brand mt-6 text-sm font-medium">
          {text(p?.jobTitle, '你好，欢迎来到我的个人网站')}
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-6xl">
          {text(p?.name, site.site.name)}
        </h1>
        <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg leading-relaxed md:text-xl">
          {text(p?.headline, site.site.description)}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {portfolio && (
            <Link
              href={portfolio.route}
              className="bg-primary text-primary-foreground rounded-lg px-5 py-3 text-sm font-medium"
            >
              看看我的作品 →
            </Link>
          )}
          {article && (
            <Link href={article.route} className="rounded-lg border px-5 py-3 text-sm font-medium">
              读读我的文章
            </Link>
          )}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
          {socials.map((s, index) => {
            const url = safeContentUrl(s.url)
            return url ? (
              <a
                key={index}
                href={url}
                rel="noopener noreferrer"
                className="text-muted-foreground underline"
              >
                {s.label || s.platform || '社交链接'}
              </a>
            ) : null
          })}
          {typeof p?.email === 'string' && (
            <a href={'mailto:' + p.email} className="text-brand">
              联系我
            </a>
          )}
        </div>
      </section>
      {!sections.length && !feed.errors.length && (
        <p className="text-muted-foreground container-page py-12 text-center">
          网站正在建设中，新的内容会陆续发布。
        </p>
      )}
      {!!feed.errors.length && (
        <div role="status" className="container-page rounded-lg border p-4 text-sm">
          部分内容暂时无法读取，请
          <a href="/" className="text-brand ml-2 underline">
            刷新重试
          </a>
          。
        </div>
      )}
      {sections.map((s) => (
        <section
          key={s.key}
          className="container-page py-10 md:py-14"
          data-home-module={s.key}
          data-motion="section"
        >
          <header className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-brand mb-2 text-xs tracking-widest">
                {
                  (
                    {
                      portfolio: 'SELECTED WORK',
                      article: 'ARTICLES',
                      log: 'JOURNAL',
                      timeline: 'TIMELINE',
                      about: 'ABOUT',
                    } as Record<string, string>
                  )[s.key]
                }
              </p>
              <h2 className="text-2xl font-bold">
                {(
                  {
                    portfolio: '精选作品',
                    article: '最新文章',
                    log: '最新日志',
                    timeline: '近期经历',
                  } as Record<string, string>
                )[s.key] ?? s.name}
              </h2>
            </div>
            <Link href={s.route} className="text-brand shrink-0 text-sm">
              全部{s.name} →
            </Link>
          </header>
          {s.key === 'portfolio' ? (
            <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-2 md:px-0 lg:grid-cols-3">
              {(s.items as Item[]).map((item) => (
                <article
                  key={item.id}
                  className="bg-card shadow-card w-[82vw] max-w-sm shrink-0 snap-start overflow-hidden rounded-xl border md:w-auto md:max-w-none"
                  data-motion="card"
                >
                  <Link href={s.route + '/' + item.slug}>
                    {cover(item.coverImage)}
                    <div className="p-5">
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                        {item.subtitle || excerpt(item.description ?? '', 100)}
                      </p>
                      {s.config.showTechStack && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {item.techStack?.slice(0, 5).map((tech) => (
                            <span key={tech} className="bg-muted rounded px-2 py-1 text-xs">
                              {tech}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-brand mt-5 text-xs">
                        {
                          (
                            {
                              GAME: '游戏',
                              REPO: '代码库',
                              SKILL: 'Skills',
                              OTHER: '个人制作',
                            } as Record<string, string>
                          )[item.type ?? 'OTHER']
                        }{' '}
                        · 查看作品 ↗
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : s.key === 'article' ? (
            <div className="grid gap-5 md:grid-cols-2">
              {(s.items as Item[]).map((item) => (
                <article
                  key={item.id}
                  className="bg-card shadow-card overflow-hidden rounded-xl border"
                  data-motion="card"
                >
                  <Link href={s.route + '/' + item.slug}>
                    {item.coverImage && cover(item.coverImage)}
                    <div className="p-5">
                      <h3 className="text-lg font-semibold">{item.title}</h3>
                      <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                        {item.summary}
                      </p>
                      <p className="text-muted-foreground mt-5 text-xs">
                        {item.publishedAt && formatDate(item.publishedAt)} · {item.readingTime}
                        分钟阅读
                      </p>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : s.key === 'log' ? (
            <div className="divide-y rounded-xl border px-5">
              {(s.items as Item[]).map((item) => (
                <article key={item.id} className="flex gap-4 py-5" data-motion="card">
                  <span className="text-brand shrink-0 text-sm">
                    {item.logDate && displayDate(item.logDate, 'MM.dd')}
                  </span>
                  <Link href={s.route + '/' + item.id} className="min-w-0">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed">
                      {item.summary}
                    </p>
                  </Link>
                </article>
              ))}
            </div>
          ) : s.key === 'timeline' ? (
            <div className="space-y-3">
              {(s.items as Item[]).map((item) => (
                <article
                  key={item.id}
                  className="flex flex-wrap items-center gap-4 rounded-xl border p-5"
                  data-motion="card"
                >
                  <span className="bg-brand size-3 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {item.organization} ·{' '}
                      {item.startDate &&
                        displayDate(item.startDate, precision(item.startPrecision))}{' '}
                      —{' '}
                      {item.isCurrent
                        ? '至今'
                        : item.endDate
                          ? displayDate(item.endDate, precision(item.endPrecision))
                          : ''}
                    </p>
                  </div>
                  {item.isCurrent && (
                    <span className="bg-brand-soft text-brand rounded-full px-3 py-1 text-xs">
                      进行中
                    </span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Link href={s.route} className="text-brand">
              了解更多 →
            </Link>
          )}
        </section>
      ))}
    </div>
  )
}
