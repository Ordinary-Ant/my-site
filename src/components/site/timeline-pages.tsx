import Link from 'next/link'
import { Fragment } from 'react'
import type { ModuleConfig } from '@/config/modules'
import { listPublicTimeline } from '@/lib/services/timeline'
import { TIMELINE_TYPES, type TimelineItem } from '@/lib/timeline-display'
import { TimelineCard } from './timeline-card'
import { JsonLd } from './json-ld'
import { absolutePublicUrl } from '@/lib/seo'

type Column = { name: string; description: string | null; route: string; config: ModuleConfig }
/** 保留服务端完整顺序，年份锚点仅分隔相邻年份，不把当前项重新排回历史位置。 */
function Track({
  items,
  groupByYear,
  offset = 0,
  anchorPrefix = 'timeline-year-',
}: {
  items: TimelineItem[]
  groupByYear: boolean
  offset?: number
  anchorPrefix?: string
}) {
  const seen = new Set<string>()
  return (
    <div className="before:bg-border relative space-y-8 border-l pl-5 before:absolute before:inset-y-0 before:left-1/2 before:hidden before:w-px lg:border-l-0 lg:pl-0 lg:before:block">
      {items.map((item, index) => {
        const year = String(
          item.startDate instanceof Date ? item.startDate.toISOString() : item.startDate,
        ).slice(0, 4)
        const previous = index
          ? String(
              items[index - 1].startDate instanceof Date
                ? (items[index - 1].startDate as Date).toISOString()
                : items[index - 1].startDate,
            ).slice(0, 4)
          : null
        const anchor = seen.has(year) ? undefined : anchorPrefix + year
        seen.add(year)
        const right = (index + offset) % 2 === 1
        return (
          <Fragment key={item.id}>
            {groupByYear && year !== previous && (
              <h2
                id={anchor}
                className="text-muted-foreground relative col-span-full scroll-mt-24 py-2 text-xl font-bold lg:text-center"
              >
                <span className="bg-background relative px-3">{year}</span>
              </h2>
            )}
            <div
              className={'relative lg:w-[calc(50%_-_28px)] ' + (right ? 'lg:ml-auto' : '')}
              data-motion="card"
              data-timeline-id={item.id}
            >
              <span
                aria-hidden="true"
                className={
                  'bg-background absolute top-7 -left-7 size-3 rounded-full border-2 ' +
                  (right ? 'lg:-left-[34px]' : 'lg:-right-[34px] lg:left-auto') +
                  (item.isCurrent ? ' border-brand' : ' border-border-strong')
                }
              />
              <TimelineCard item={item} idPrefix={anchorPrefix} />
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
export async function TimelineIndex({ column, query }: { column: Column; query: URLSearchParams }) {
  const request = new URLSearchParams(query)
  request.delete('view')
  request.delete('fields')
  const { data } = await listPublicTimeline(request)
  const group = column.config.groupByYear !== false,
    years = [
      ...new Set(
        data.map((item) =>
          String(
            item.startDate instanceof Date ? item.startDate.toISOString() : item.startDate,
          ).slice(0, 4),
        ),
      ),
    ]
  const href = (type: string | null) => {
    const next = new URLSearchParams(query)
    if (type) next.set('type', type)
    else next.delete('type')
    return column.route + (next.size ? '?' + next : '')
  }
  return (
    <div className="container-page py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'CollectionPage', name: column.name, url: absolutePublicUrl(column.route) },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: column.name,
                  item: absolutePublicUrl(column.route),
                },
              ],
            },
          ],
        }}
      />
      <header className="mb-8">
        <p className="text-brand mb-3 text-sm font-medium">MY JOURNEY</p>
        <h1 className="text-4xl font-bold">{column.name}</h1>
        <p className="text-muted-foreground mt-4">{column.config.intro ?? column.description}</p>
      </header>
      <nav aria-label="经历类型" className="mb-8 flex flex-wrap gap-3 text-sm">
        <Link href={href(null)} aria-current={!query.get('type') ? 'page' : undefined}>
          全部
        </Link>
        {Object.entries(TIMELINE_TYPES)
          .filter(([type]) => column.config.types?.[type] !== false)
          .map(([type, value]) => (
            <Link
              key={type}
              href={href(type)}
              aria-current={query.get('type') === type ? 'page' : undefined}
            >
              {value.icon} {value.label}
            </Link>
          ))}
      </nav>
      {!data.length ? (
        <div className="text-muted-foreground py-16 text-center">
          <p>{query.get('type') ? '该类型暂无记录' : (column.config.emptyText ?? '还没有记录')}</p>
          <Link href={column.route} className="text-brand mt-4 inline-block">
            重置筛选
          </Link>
        </div>
      ) : (
        <div className="grid items-start gap-10 xl:grid-cols-[1fr_100px]">
          <div>
            {data.length > 30 ? (
              <>
                <div className="lg:hidden">
                  <Track
                    items={data.slice(0, 30)}
                    groupByYear={group}
                    anchorPrefix="timeline-mobile-year-"
                  />
                  <details className="mt-8">
                    <summary className="text-brand cursor-pointer text-sm">
                      更早的经历（{data.length - 30}条）
                    </summary>
                    <div className="mt-8">
                      <Track
                        items={data.slice(30)}
                        groupByYear={group}
                        offset={30}
                        anchorPrefix="timeline-mobile-older-year-"
                      />
                    </div>
                  </details>
                </div>
                <div className="hidden lg:block">
                  <Track items={data} groupByYear={group} />
                </div>
              </>
            ) : (
              <Track items={data} groupByYear={group} />
            )}
          </div>
          {group && (
            <nav aria-label="经历年份" className="sticky top-24 hidden space-y-3 text-sm xl:block">
              {years.map((year) => (
                <a
                  className="text-muted-foreground hover:text-brand block"
                  href={'#timeline-year-' + year}
                  key={year}
                >
                  {year}
                </a>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  )
}
