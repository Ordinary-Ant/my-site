import Image from 'next/image'
import { TIMELINE_TYPES, timelineDate, type TimelineItem } from '@/lib/timeline-display'
import { safeContentUrl } from '@/lib/markdown'
import { Markdown } from './markdown'

/** 同源经历卡片；正文用原生details，关闭JS仍可展开职业故事。 */
export function TimelineCard({
  item,
  idPrefix = 'timeline-',
}: {
  item: TimelineItem
  idPrefix?: string
}) {
  const kind = TIMELINE_TYPES[item.type],
    logo = item.logo ? safeContentUrl(item.logo) : null
  return (
    <article
      className={
        'bg-card rounded-xl border p-5 ' + (item.isCurrent ? 'border-brand shadow-card' : '')
      }
      data-timeline-type={item.type}
    >
      <div className="text-muted-foreground mb-4 flex flex-wrap items-center gap-3 text-xs">
        <span style={{ color: kind.color }}>
          {kind.icon} {kind.label}
        </span>
        <time>
          {timelineDate(item.startDate, item.startPrecision)} —{' '}
          {item.isCurrent || !item.endDate ? '至今' : timelineDate(item.endDate, item.endPrecision)}
        </time>
        {item.isCurrent && <span className="text-brand">进行中</span>}
      </div>
      <div className="flex items-start gap-3">
        {logo && (
          <Image
            src={logo}
            alt={item.organization ?? ''}
            width={40}
            height={40}
            unoptimized
            className="size-10 shrink-0 rounded-lg object-contain"
          />
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-semibold break-words">{item.title}</h2>
          {item.subtitle && <p className="text-muted-foreground mt-2 text-sm">{item.subtitle}</p>}
          <p className="text-muted-foreground mt-2 text-sm">
            {[item.organization, item.location].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {!!item.highlights.length && (
        <ul className="mt-5 space-y-2 text-sm leading-relaxed">
          {item.highlights.map((text, index) => (
            <li key={index}>✓ {text}</li>
          ))}
        </ul>
      )}
      {!!item.tags.length && (
        <div className="mt-5 flex flex-wrap gap-2">
          {item.tags.map((tag, index) => (
            <span key={index} className="bg-muted rounded-full px-2 py-1 text-xs">
              {tag}
            </span>
          ))}
        </div>
      )}
      {item.description && (
        <details className="mt-5 border-t pt-4">
          <summary className="text-brand cursor-pointer text-sm">展开经历详情</summary>
          <div className="mt-4">
            <Markdown source={item.description} idPrefix={idPrefix + item.id + '-'} />
          </div>
        </details>
      )}
    </article>
  )
}
