import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ApiError } from '@/lib/api/errors'
import { getPublicArticle, listPublicArticles } from '@/lib/services/article'
import { applyPublicPrivacy, requirePageModule } from '@/lib/services/public-site'
import { Markdown } from '@/components/site/markdown'
import { excerpt, formatDate } from '@/lib/utils'

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
  if (matched.key !== 'article') notFound()
  const suffix = route.slice(matched.route.length).replace(/^\//, '')
  if (suffix.includes('/')) notFound()
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { matched, suffix } = await resolve((await params).path)
  if (!suffix) return { title: matched.name }
  const article = await articleOr404(suffix)
  return {
    title: article.seoTitle ?? article.title,
    description: article.seoDescription ?? article.summary ?? excerpt(article.content),
    alternates: { canonical: `${matched.route}/${article.slug}` },
    openGraph: {
      type: 'article',
      title: article.title,
      ...(article.ogImage || article.coverImage
        ? { images: [article.ogImage ?? article.coverImage!] }
        : {}),
    },
  }
}

export default async function ContentPage({ params, searchParams }: Props) {
  const { matched, suffix } = await resolve((await params).path)
  if (suffix) {
    const article = await articleOr404(suffix)
    return (
      <article className="container-prose py-12">
        <Link href={matched.route} className="text-brand text-sm">
          ← 全部文章
        </Link>
        <header className="my-8">
          <div className="text-muted-foreground mb-3 text-sm">
            {article.category?.name ?? '文章'} · {formatDate(article.publishedAt!)} ·{' '}
            {article.readingTime} 分钟阅读
          </div>
          <h1 className="text-3xl leading-tight font-bold md:text-4xl">{article.title}</h1>
          {article.summary && (
            <p className="text-muted-foreground mt-5 text-lg">{article.summary}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`${matched.route}?tag=${tag.slug}`}
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
