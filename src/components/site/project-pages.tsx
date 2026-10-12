import { ImageGallery } from './content-widgets'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ApiError } from '@/lib/api/errors'
import { getPublicProject, listPublicProjects } from '@/lib/services/project'
import type { ModuleConfig } from '@/config/modules'
import { PROJECT_TYPES, projectDate, projectLinks } from '@/lib/project-display'
import { ProjectCard } from './project-card'

import { Markdown } from './markdown'
import { ViewCounter } from './view-counter'
import { JsonLd } from './json-ld'
import { absolutePublicUrl } from '@/lib/seo'

type Column = { name: string; description: string | null; route: string; config: ModuleConfig }
export async function projectOr404(slug: string) {
  try {
    return await getPublicProject(slug)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}
/** 栏目配置决定默认布局与徽章，分享URL里的显式筛选优先。 */
export async function ProjectIndex({ column, query }: { column: Column; query: URLSearchParams }) {
  const request = new URLSearchParams(query)
  request.delete('view')
  request.delete('fields')
  const result = await listPublicProjects(request),
    { data, meta } = result
  const view =
    query.get('view') === 'list'
      ? 'list'
      : query.get('view') === 'grid'
        ? 'grid'
        : (column.config.layout ?? 'grid')
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    return column.route + '?' + next
  }
  const types = Object.entries(PROJECT_TYPES).filter(
    ([key]) => column.config.types?.[key] !== false,
  )
  const columns =
    data.length === 1
      ? 'mx-auto max-w-md'
      : data.length === 2
        ? 'mx-auto max-w-3xl md:grid-cols-2'
        : 'md:grid-cols-2 xl:grid-cols-3'
  return (
    <div className="container-page py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: column.name,
          url: absolutePublicUrl(column.route),
        }}
      />
      <header className="mb-8">
        <p className="text-brand mb-3 text-sm font-medium">SELECTED WORK</p>
        <h1 className="text-4xl font-bold">{column.name}</h1>
        <p className="text-muted-foreground mt-4">{column.config.intro ?? column.description}</p>
      </header>
      <form className="mb-6 flex flex-wrap gap-3">
        <input
          name="q"
          aria-label="搜索作品"
          placeholder="搜索作品"
          defaultValue={query.get('q') ?? ''}
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2"
        />
        <select
          name="sort"
          aria-label="作品排序"
          defaultValue={query.get('sort') ?? ''}
          className="bg-background rounded-lg border px-3 py-2"
        >
          <option value="">默认顺序</option>
          <option value="latest">最新优先</option>
        </select>
        {['type', 'tech', 'tag', 'featured', 'view', 'from', 'to', 'pageSize'].map((key) =>
          query.get(key) ? (
            <input key={key} type="hidden" name={key} value={query.get(key)!} />
          ) : null,
        )}
        <button className="bg-primary text-primary-foreground rounded-lg px-4 py-2">筛选</button>
      </form>
      <nav aria-label="作品类型" className="mb-6 flex flex-wrap gap-3 text-sm">
        <Link
          href={href({ type: null, page: null })}
          aria-current={!query.get('type') ? 'page' : undefined}
        >
          全部 {Object.values(meta.typeCounts).reduce((sum, count) => sum + count, 0)}
        </Link>
        {types.map(([key, kind]) => (
          <Link
            key={key}
            href={href({ type: key, page: null })}
            aria-current={query.get('type') === key ? 'page' : undefined}
          >
            {kind.icon} {kind.label} {meta.typeCounts[key as keyof typeof meta.typeCounts]}
          </Link>
        ))}
      </nav>
      <nav aria-label="作品视图" className="mb-6 flex gap-4 text-sm">
        {['grid', 'list'].map((mode) => (
          <Link
            key={mode}
            href={href({ view: mode })}
            aria-current={view === mode ? 'page' : undefined}
          >
            {mode === 'grid' ? '网格' : '列表'}
          </Link>
        ))}
      </nav>
      {query.get('tech') && (
        <p className="mb-6 text-sm">
          技术栈：{query.get('tech')}{' '}
          <Link className="text-brand ml-3" href={href({ tech: null, page: null })}>
            清除筛选
          </Link>
        </p>
      )}
      {data.length ? (
        <div className={'grid gap-6 ' + (view === 'grid' ? columns : '')}>
          {data.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              route={column.route}
              showTechStack={column.config.showTechStack !== false}
              compact={view === 'list'}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-16 text-center">
          {column.config.emptyText ?? '还没有作品'}
        </p>
      )}
      <nav aria-label="作品分页" className="mt-8 flex justify-between text-sm">
        {meta.hasPrev ? <Link href={href({ page: String(meta.page - 1) })}>上一页</Link> : <span />}
        <span>
          第{meta.page}页 · 共{meta.total}项
        </span>
        {meta.hasNext ? (
          <Link href={href({ page: String(meta.page + 1) })}>下一页 →</Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}
export function ProjectDetail({
  item,
  column,
}: {
  item: Awaited<ReturnType<typeof getPublicProject>>
  column: Column
}) {
  const images = [...new Set([...(item.coverImage ? [item.coverImage] : []), ...item.gallery])]
  return (
    <article className="container-page py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CreativeWork',
          name: item.title,
          description: item.description,
          url: absolutePublicUrl(column.route + '/' + item.slug),
        }}
      />
      <ViewCounter resource="project" id={item.id} initialCount={item.viewCount} />
      <Link href={column.route} className="text-brand text-sm">
        ← 返回作品集
      </Link>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          {images.length ? (
            <ImageGallery images={images} title={item.title} feature />
          ) : (
            <div className="bg-brand-soft text-brand flex aspect-video items-center justify-center rounded-xl text-6xl">
              {PROJECT_TYPES[item.type].icon}
            </div>
          )}
        </div>
        <header>
          <p className="text-muted-foreground mb-4 text-sm">
            {PROJECT_TYPES[item.type].icon} {PROJECT_TYPES[item.type].label}
            {item.role && ' · ' + item.role}
          </p>
          <h1 className="text-4xl font-bold">{item.title}</h1>
          {item.subtitle && <p className="text-brand mt-4 text-lg">{item.subtitle}</p>}
          <p className="text-muted-foreground mt-5 leading-relaxed">{item.description}</p>
          {item.startDate && (
            <p className="text-muted-foreground mt-4 text-sm">
              {projectDate(item.startDate)} — {projectDate(item.endDate) || '进行中'}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {projectLinks(item.links).map((link) => (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  link.key === 'demo'
                    ? 'bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm'
                    : 'text-brand rounded-lg border px-4 py-2 text-sm'
                }
              >
                {link.label} ↗
              </a>
            ))}
          </div>
          {item.highlights.length > 0 && (
            <ul aria-label="作品亮点" className="mt-6 space-y-3 text-lg">
              {item.highlights.map((text, index) => (
                <li key={index}>✓ {text}</li>
              ))}
            </ul>
          )}
          {column.config.showTechStack !== false && (
            <div className="mt-6 flex flex-wrap gap-2">
              {item.techStack.map((tech) => (
                <Link
                  key={tech}
                  href={column.route + '?tech=' + encodeURIComponent(tech)}
                  className="bg-muted rounded-full px-3 py-1 text-sm"
                >
                  {tech}
                </Link>
              ))}
            </div>
          )}
        </header>
      </div>
      {item.content && (
        <section aria-label="作品正文" className="container-prose mt-12">
          <Markdown source={item.content} />
        </section>
      )}
      {!!item.tags.length && (
        <div className="mt-8 flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <Link
              key={tag.id}
              className="bg-muted rounded-full px-3 py-1 text-xs"
              href={column.route + '?tag=' + encodeURIComponent(tag.slug)}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      )}
      <nav
        aria-label="相邻作品"
        className="mt-12 flex flex-wrap justify-between gap-5 border-t pt-6 text-sm"
      >
        {item.prev ? (
          <Link href={column.route + '/' + item.prev.slug}>← {item.prev.title}</Link>
        ) : (
          <span />
        )}
        {item.next && <Link href={column.route + '/' + item.next.slug}>{item.next.title} →</Link>}
      </nav>
    </article>
  )
}
