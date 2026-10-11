import Link from 'next/link'
import type { getArticleArchive } from '@/lib/services/search'
import { formatDate } from '@/lib/utils'
import { JsonLd } from './json-ld'
import { absolutePublicUrl } from '@/lib/seo'
export type ArticleArchiveData = Awaited<ReturnType<typeof getArticleArchive>>
export function ArticleArchive({ data }: { data: ArticleArchiveData }) {
  const { pagination: meta } = data
  // 翻页沿用当前每页条数，避免自定义分页时跳过文章。
  const pageUrl = (page: number) =>
    data.url + '?' + new URLSearchParams({ page: String(page), pageSize: String(meta.pageSize) })
  return (
    <div className="container-prose py-12">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: data.title,
          url: absolutePublicUrl(data.url),
        }}
      />
      <Link href={data.currentRoute} className="text-brand text-sm">
        ← 全部文章
      </Link>
      <h1 className="mt-6 text-3xl font-bold break-words">{data.title}</h1>
      {data.description && (
        <p className="text-muted-foreground mt-4 break-words">{data.description}</p>
      )}
      <div className="mt-8 divide-y">
        {data.items.map((item) => (
          <article key={item.id} className="py-7 break-words">
            <p className="text-muted-foreground text-sm">
              {formatDate(item.publishedAt!)} · {item.readingTime} 分钟阅读
            </p>
            <h2 className="my-3 text-xl font-semibold">
              <Link href={data.currentRoute + '/' + item.slug}>{item.title}</Link>
            </h2>
            {item.summary && <p className="text-muted-foreground">{item.summary}</p>}
          </article>
        ))}
      </div>
      <nav aria-label="分页" className="mt-8 flex justify-between gap-3 text-sm">
        {meta.hasPrev ? <Link href={pageUrl(meta.page - 1)}>← 上一页</Link> : <span />}
        <span>
          第 {meta.page} 页 · 共 {meta.total} 篇
        </span>
        {meta.hasNext ? <Link href={pageUrl(meta.page + 1)}>下一页 →</Link> : <span />}
      </nav>
    </div>
  )
}
