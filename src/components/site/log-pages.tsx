import {
  ImageGallery,
  LogCalendar,
  ReadingActions,
  LogView,
  LogMore,
  LogNavigation,
} from './content-widgets'
import Link from 'next/link'
import Image from 'next/image'
import { getPublicLog, listPublicLogs, getLogCalendar } from '@/lib/services/log'
import { Markdown } from './markdown'

import { chinaToday, LOG_TYPES, MOODS, WEATHER } from '@/lib/log-display'
import { safeContentUrl } from '@/lib/markdown'
import type { ModuleConfig } from '@/config/modules'
import { ApiError } from '@/lib/api/errors'
import { notFound } from 'next/navigation'
import { ViewCounter } from './view-counter'
import { JsonLd } from './json-ld'
import { absolutePublicUrl } from '@/lib/seo'

type PublicLog = Awaited<ReturnType<typeof getPublicLog>>
type SiteModule = { name: string; description: string | null; route: string; config: ModuleConfig }
export async function logOr404(id: string) {
  try {
    return await getPublicLog(id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}
const dateTitle = (day: string) =>
  new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(day + 'T00:00:00Z'),
  )
export function LogDetail({ item, column }: { item: PublicLog; column: SiteModule }) {
  const cover = item.coverImage ? safeContentUrl(item.coverImage) : null
  return (
    <article className="container-prose py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: item.title,
          url: absolutePublicUrl(column.route + '/' + item.id),
          datePublished: item.publishedAt?.toISOString(),
          dateModified: item.updatedAt.toISOString(),
        }}
      />
      <ReadingActions route={column.route} backOnly />
      <header className="my-8">
        <p className="text-muted-foreground mb-4 text-sm">
          {dateTitle(item.logDate)} · {LOG_TYPES[item.type]}
          {item.mood && ' · ' + (MOODS[item.mood as keyof typeof MOODS] ?? item.mood)}
          {item.weather && ' · ' + (WEATHER[item.weather as keyof typeof WEATHER] ?? item.weather)}
          {item.location && ' · ' + item.location}
        </p>
        <h1 className="text-3xl font-bold md:text-4xl">{item.title}</h1>
        <ViewCounter resource="log" id={item.id} initialCount={item.viewCount} visible={false} />
        {item.summary && <p className="text-muted-foreground mt-5 text-lg">{item.summary}</p>}
      </header>
      {cover && (
        <Image
          src={cover}
          alt={item.title + '封面'}
          width={1200}
          height={675}
          unoptimized
          className="mb-8 h-auto w-full rounded-xl"
        />
      )}
      <Markdown source={item.content} />
      <ImageGallery images={item.images} title={item.title} />
      <div className="mt-8 flex flex-wrap gap-2">
        {item.tags.map((tag) => (
          <Link
            key={tag.id}
            href={column.route + '?tag=' + encodeURIComponent(tag.slug)}
            className="bg-muted rounded-full px-3 py-1 text-xs"
          >
            {tag.name}
          </Link>
        ))}
      </div>
      <nav
        aria-label="相邻日志"
        className="mt-10 flex flex-wrap justify-between gap-6 border-t pt-6 text-sm"
      >
        {item.prev ? (
          <Link href={column.route + '/' + item.prev.id}>← {item.prev.title}</Link>
        ) : (
          <span />
        )}
        {item.next && <Link href={column.route + '/' + item.next.id}>{item.next.title} →</Link>}
      </nav>
      <ReadingActions route={column.route} />
    </article>
  )
}
/** 日志列表与日历复用同一公开筛选，禁用JS仍可筛选与分页。 */
export async function LogIndex({ column, query }: { column: SiteModule; query: URLSearchParams }) {
  const today = chinaToday(),
    view = query.get('view') ?? column.config.defaultView ?? 'list'
  const calendarDate = query.get('date') ?? today
  const year = Number(query.get('year')) || Number(calendarDate.slice(0, 4)),
    month = Math.max(
      1,
      Math.min(12, Number(query.get('month')) || Number(calendarDate.slice(5, 7))),
    )
  const request = new URLSearchParams(query)
  request.delete('view')
  request.delete('fields')
  if (view === 'calendar' && !request.get('date')) {
    request.set('year', String(year))
    request.set('month', String(month))
  }
  const { data, meta } = await listPublicLogs(request)
  const calendar =
    view === 'calendar'
      ? await getLogCalendar(
          new URLSearchParams({
            year: String(year),
            ...(query.get('type') ? { type: query.get('type')! } : {}),
            ...(query.get('q') ? { q: query.get('q')! } : {}),
            ...(query.get('tag') ? { tag: query.get('tag')! } : {}),
            ...(query.get('mood') ? { mood: query.get('mood')! } : {}),
            ...(query.get('from') ? { from: query.get('from')! } : {}),
            ...(query.get('to') ? { to: query.get('to')! } : {}),
          }),
        )
      : null
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    return column.route + '?' + next
  }
  const types = Object.entries(LOG_TYPES).filter(([key]) => column.config.types?.[key] !== false)
  let group = ''
  return (
    <div className="container-page py-12">
      <LogNavigation route={column.route} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: column.name,
          url: absolutePublicUrl(column.route),
        }}
      />
      <header className="mb-8">
        <p className="text-brand mb-3 text-sm font-medium">JOURNAL</p>
        <h1 className="text-4xl font-bold">{column.name}</h1>
        <p className="text-muted-foreground mt-4">{column.config.intro ?? column.description}</p>
      </header>
      <form className="mb-6 flex flex-wrap gap-3">
        <input
          aria-label="搜索日志"
          placeholder="搜索日志"
          name="q"
          defaultValue={query.get('q') ?? ''}
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2"
        />
        <select
          aria-label="日志年份"
          name="year"
          defaultValue={query.get('year') ?? ''}
          className="bg-background rounded-lg border px-3 py-2"
        >
          <option value="">全部年份</option>
          {Array.from({ length: 15 }, (_, index) => Number(today.slice(0, 4)) - index).map(
            (value) => (
              <option key={value} value={value}>
                {value}年
              </option>
            ),
          )}
        </select>
        <input type="hidden" name="view" value={view} />
        {query.get('type') && <input type="hidden" name="type" value={query.get('type')!} />}
        <button className="bg-primary text-primary-foreground rounded-lg px-4 py-2">筛选</button>
      </form>
      <nav aria-label="日志类型" className="mb-5 flex flex-wrap gap-3 text-sm">
        <Link
          href={href({ type: null, page: null })}
          aria-current={!query.get('type') ? 'page' : undefined}
        >
          全部
        </Link>
        {types.map(([type, label]) => (
          <Link
            key={type}
            href={href({ type, page: null })}
            aria-current={query.get('type') === type ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <LogView route={column.route} query={query.toString()} view={view} />
      {calendar && (
        <div className="mb-8 max-w-lg">
          <LogCalendar
            data={calendar}
            month={month}
            path={column.route}
            query={query.toString()}
            selectedDate={query.get('date') ?? undefined}
          />
        </div>
      )}
      <div className="grid gap-x-6 md:grid-cols-2">
        {data.map((item) => {
          const nextGroup = item.logDate.slice(0, 7),
            heading = group !== nextGroup
          group = nextGroup
          return (
            <section key={item.id} className="contents">
              {heading && (
                <h2 className="text-muted-foreground mt-8 border-b pb-3 text-sm md:col-span-2">
                  {nextGroup.replace('-', '年')}月
                </h2>
              )}
              <article className="relative border-b py-6">
                {item.coverImage && safeContentUrl(item.coverImage) && (
                  <Image
                    src={safeContentUrl(item.coverImage)!}
                    alt={item.title + '封面'}
                    width={800}
                    height={450}
                    unoptimized
                    className="mb-4 aspect-video w-full rounded-xl object-cover"
                  />
                )}
                <p className="text-muted-foreground text-sm">
                  {item.logDate} · {LOG_TYPES[item.type]}
                  {item.mood && ' · ' + (MOODS[item.mood as keyof typeof MOODS] ?? item.mood)}
                </p>
                <h3 className="my-3 text-xl font-semibold">
                  <Link
                    href={column.route + '/' + item.id}
                    className="hover:text-brand after:absolute after:inset-0 focus-visible:after:rounded-lg focus-visible:after:outline-2"
                  >
                    {item.isPinned && '📌 '}
                    {item.title}
                  </Link>
                </h3>
                {item.summary && (
                  <p className="text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <Link
                      key={tag.id}
                      href={href({ tag: tag.slug, page: null })}
                      className="bg-muted relative z-10 rounded-full px-2 py-1 text-xs"
                    >
                      {tag.name}
                    </Link>
                  ))}
                </div>
              </article>
            </section>
          )
        })}
        {!data.length && (
          <p className="text-muted-foreground py-12 text-center">
            {query.get('date') ? '这天没有记录' : (column.config.emptyText ?? '还没有日志')}
          </p>
        )}
      </div>
      {view === 'list' && (
        <LogMore
          key={column.route + '?' + request.toString()}
          route={column.route}
          query={request.toString()}
          page={meta.page}
          hasNext={meta.hasNext}
          lastMonth={data.at(-1)?.logDate.slice(0, 7) ?? ''}
        />
      )}
      <nav aria-label="日志分页" className="mt-8 flex justify-between text-sm">
        {meta.hasPrev ? <Link href={href({ page: String(meta.page - 1) })}>上一页</Link> : <span />}
        <span>
          第{meta.page}页 · 共{meta.total}条
        </span>
        {meta.hasNext && (
          <Link href={href({ page: String(meta.page + 1) })}>
            <span>下一页 →</span>
          </Link>
        )}
      </nav>
    </div>
  )
}
