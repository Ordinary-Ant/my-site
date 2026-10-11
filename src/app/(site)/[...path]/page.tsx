import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { z } from 'zod'
import { ApiError } from '@/lib/api/errors'
import { getPublicArticle, listPublicArticles } from '@/lib/services/article'
import { applyPublicPrivacy, requirePageModule } from '@/lib/services/public-site'
import { Markdown } from '@/components/site/markdown'
import { excerpt, formatDate } from '@/lib/utils'
import { getArticleArchive } from '@/lib/services/search'
import { ArticleArchive } from '@/components/site/article-archive'
import { JsonLd } from '@/components/site/json-ld'
import { absolutePublicUrl } from '@/lib/seo'
import { ViewCounter } from '@/components/site/view-counter'

export const dynamic = 'force-dynamic'
type Props = {
  params: Promise<{ path: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** 栏目从数据库路径解析，固定系统路由由独立页面处理。 */
async function resolve(path: string[]) {
  const route = `/${path.join('/')}`
  // 页面与metadata复用公开DTO，栏目文字和配置也受联系方式开关约束。
  const matched = await requirePageModule(path)
    .then(applyPublicPrivacy)
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound()
      throw error
    })
  if (!['article', 'log', 'portfolio', 'timeline', 'about'].includes(matched.key)) notFound()
  const suffix = route.slice(matched.route.length).replace(/^\//, '')
  if (
    suffix.includes('/') &&
    !(matched.key === 'article' && /^(category|tag)\/[^/]+$/.test(suffix))
  )
    notFound()
  if (['timeline', 'about'].includes(matched.key) && suffix) notFound()
  return { matched, suffix }
}

async function articleOr404(slug: string) {
  try {
    return await getPublicArticle(slug)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}

async function archiveOr404(suffix: string, query = new URLSearchParams()) {
  const [kind, slug] = suffix.split('/')
  try {
    return await getArticleArchive(kind as 'category' | 'tag', slug, query)
  } catch (error) {
    if (error instanceof z.ZodError) notFound()
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}
/** 页面与分享图只用公开服务返回的标题和当前地址。 */
function pageMetadata(
  title: string,
  description: string | null,
  path: string,
  resource?: string,
  id?: string,
  image?: string | null,
): Metadata {
  const og =
    image || (resource ? '/api/v1/og?' + new URLSearchParams({ resource, id: id! }) : '/api/v1/og')
  return {
    title,
    description: description ?? undefined,
    alternates: { canonical: path },
    openGraph: {
      type: resource === 'article' || resource === 'log' ? 'article' : 'website',
      title,
      description: description ?? undefined,
      url: path,
      images: [og],
    },
    twitter: { card: 'summary_large_image', title, images: [og] },
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matched, suffix } = await resolve((await params).path)
  if (matched.key === 'about') {
    const { getPublicProfile } = await import('@/lib/services/profile')
    const profile = await getPublicProfile()
    return pageMetadata(
      matched.name,
      profile.headline ?? matched.description,
      matched.route,
      undefined,
      undefined,
      profile.avatar,
    )
  }
  if (!suffix) return pageMetadata(matched.name, matched.description, matched.route)
  if (matched.key === 'article' && suffix.includes('/')) {
    const archive = await archiveOr404(suffix)
    return pageMetadata(archive.title, archive.description, archive.url)
  }
  if (matched.key === 'portfolio') {
    const { projectOr404 } = await import('@/components/site/project-pages')
    const item = await projectOr404(suffix)
    return pageMetadata(
      item.title,
      excerpt(item.description),
      matched.route + '/' + item.slug,
      'project',
      item.slug,
      item.coverImage,
    )
  }
  if (matched.key === 'log') {
    const { logOr404 } = await import('@/components/site/log-pages')
    const item = await logOr404(suffix)
    return pageMetadata(
      item.title,
      item.summary ?? excerpt(item.content),
      matched.route + '/' + item.id,
      'log',
      item.id,
    )
  }
  const article = await articleOr404(suffix)
  return pageMetadata(
    article.seoTitle ?? article.title,
    article.seoDescription ?? article.summary ?? excerpt(article.content),
    `${matched.route}/${article.slug}`,
    'article',
    article.slug,
    article.ogImage ?? article.coverImage,
  )
}

export default async function ContentPage({ params, searchParams }: Props) {
  const { matched, suffix } = await resolve((await params).path)
  if (matched.key === 'about') {
    const { AboutPage } = await import('@/components/site/about-page')
    return <AboutPage />
  }
  if (matched.key === 'timeline') {
    const { TimelineIndex } = await import('@/components/site/timeline-pages')
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams))
      if (typeof value === 'string') query.set(key, value)
    return <TimelineIndex column={matched} query={query} />
  }
  if (matched.key === 'portfolio') {
    const { ProjectDetail, ProjectIndex, projectOr404 } =
      await import('@/components/site/project-pages')
    if (suffix) return <ProjectDetail item={await projectOr404(suffix)} column={matched} />
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams))
      if (typeof value === 'string') query.set(key, value)
    return <ProjectIndex column={matched} query={query} />
  }
  if (matched.key === 'log') {
    const { LogDetail, LogIndex, logOr404 } = await import('@/components/site/log-pages')
    if (suffix) return <LogDetail item={await logOr404(suffix)} column={matched} />
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(await searchParams))
      if (typeof value === 'string') query.set(key, value)
    return <LogIndex column={matched} query={query} />
  }
  if (suffix) {
    if (suffix.includes('/')) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(await searchParams))
        if (typeof value === 'string') query.set(key, value)
      return <ArticleArchive data={await archiveOr404(suffix, query)} />
    }
    const article = await articleOr404(suffix)
    return (
      <article className="container-prose py-12">
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'BlogPosting',
                headline: article.title,
                description: article.summary ?? undefined,
                url: absolutePublicUrl(matched.route + '/' + article.slug),
                datePublished: article.publishedAt?.toISOString(),
                dateModified: article.updatedAt.toISOString(),
                author: { '@type': 'Person', name: article.author?.name ?? '站点作者' },
              },
              {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  {
                    '@type': 'ListItem',
                    position: 1,
                    name: matched.name,
                    item: absolutePublicUrl(matched.route),
                  },
                  {
                    '@type': 'ListItem',
                    position: 2,
                    name: article.title,
                    item: absolutePublicUrl(matched.route + '/' + article.slug),
                  },
                ],
              },
            ],
          }}
        />
        <Link href={matched.route} className="text-brand text-sm">
          ← 全部文章
        </Link>
        <header className="my-8">
          <div className="text-muted-foreground mb-3 text-sm">
            {article.category ? (
              <Link href={`${matched.route}/category/${article.category.slug}`}>
                {article.category.name}
              </Link>
            ) : (
              '文章'
            )}{' '}
            · {formatDate(article.publishedAt!)} · {article.readingTime} 分钟阅读
          </div>
          <h1 className="text-3xl leading-tight font-bold md:text-4xl">{article.title}</h1>
          <ViewCounter
            resource="article"
            id={article.id}
            initialCount={article.viewCount}
            visible={matched.config.showViewCount !== false}
          />
          {article.summary && (
            <p className="text-muted-foreground mt-5 text-lg">{article.summary}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`${matched.route}/tag/${tag.slug}`}
                className="bg-muted rounded-full px-3 py-1 text-xs"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        </header>
        {matched.config.showToc !== false && article.toc.length > 0 && (
          <details className="mb-8 rounded-xl border p-4">
            <summary className="cursor-pointer">文章目录</summary>
            <ol className="mt-3 space-y-2 text-sm">
              {article.toc.map((item) => (
                <li key={item.id} style={{ paddingLeft: (item.depth - 2) * 16 }}>
                  <a href={`#${item.id}`}>{item.text}</a>
                </li>
              ))}
            </ol>
          </details>
        )}
        <Markdown source={article.content} />
        <footer className="text-muted-foreground mt-12 border-t pt-6 text-sm">
          作者：{article.author?.name ?? '站点作者'} · 更新于 {formatDate(article.updatedAt)}
        </footer>
      </article>
    )
  }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === 'string') query.set(key, value)
  const { data, meta } = await listPublicArticles(query)
  const pagination = (page: number) => {
    const next = new URLSearchParams(query)
    next.set('page', String(page))
    return `${matched.route}?${next}`
  }
  return (
    <div className="container-prose py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: matched.name,
          url: absolutePublicUrl(matched.route),
        }}
      />
      <header className="mb-10">
        <p className="text-brand mb-3 text-sm font-medium">WRITING</p>
        <h1 className="text-4xl font-bold">{matched.name}</h1>
        <p className="text-muted-foreground mt-4">{matched.config.intro ?? matched.description}</p>
      </header>
      <form className="mb-8 flex gap-2">
        <input
          name="q"
          defaultValue={query.get('q') ?? ''}
          placeholder="搜索文章"
          aria-label="搜索文章"
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-4 py-2"
        />
        <button className="bg-primary text-primary-foreground rounded-lg px-4">搜索</button>
      </form>
      <div className="divide-y">
        {data.map((article) => (
          <article key={article.id} className="py-7">
            <div className="text-muted-foreground text-sm">
              {formatDate(article.publishedAt!)} · {article.category?.name ?? '文章'} ·{' '}
              {article.readingTime} 分钟
            </div>
            <h2 className="my-3 text-xl font-semibold">
              <Link href={`${matched.route}/${article.slug}`} className="hover:text-brand">
                {article.isTop && <span className="text-brand mr-2 text-xs">置顶</span>}
                {article.title}
              </Link>
            </h2>
            {article.summary && (
              <p className="text-muted-foreground leading-relaxed">{article.summary}</p>
            )}
          </article>
        ))}
        {!data.length && (
          <p className="text-muted-foreground py-12 text-center">
            {matched.config.emptyText ?? '暂无文章，稍后再来看看。'}
          </p>
        )}
      </div>
      <nav aria-label="分页" className="mt-8 flex justify-between">
        {meta.hasPrev ? <Link href={pagination(meta.page - 1)}>← 上一页</Link> : <span />}
        <span className="text-muted-foreground text-sm">
          第 {meta.page} 页 · 共 {meta.total} 篇
        </span>
        {meta.hasNext ? <Link href={pagination(meta.page + 1)}>下一页 →</Link> : <span />}
      </nav>
    </div>
  )
}
