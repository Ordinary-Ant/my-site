import Link from 'next/link'
import type { Metadata } from 'next'
import { z } from 'zod'
import { searchPublicContent } from '@/lib/services/search'
import { searchHighlightParts } from '@/lib/search-display'
import { formatDate } from '@/lib/utils'
export const dynamic = 'force-dynamic'
const types = { all: '全部', article: '文章', log: '日志', project: '作品' } as const
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q
  return {
    title: typeof q === 'string' && q.trim() ? '搜索：' + q.trim().slice(0, 200) : '搜索',
    robots: { index: false, follow: true },
  }
}
/** 原生GET表单和链接支持无JS搜索，服务端提供安全文本高亮。 */
export default async function SearchPage({ searchParams }: Props) {
  const input = await searchParams,
    params = new URLSearchParams()
  for (const key of ['q', 'type', 'page', 'pageSize'])
    if (typeof input[key] === 'string') params.set(key, input[key])
  const result = await searchPublicContent(params).catch((error) => {
    if (error instanceof z.ZodError) return null
    throw error
  })
  const q = (params.get('q') ?? '').slice(0, 200),
    type = params.get('type') ?? 'all'
  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) next.set(key, value)
    return '/search?' + next
  }
  return (
    <div className="container-prose py-12">
      <h1 className="mb-6 text-3xl font-bold">搜索</h1>
      <form action="/search" method="get" role="search" className="flex gap-2">
        <input
          name="q"
          aria-label="搜索文章、日志、作品"
          placeholder="搜索文章、日志、作品…"
          defaultValue={q}
          maxLength={200}
          className="min-w-0 flex-1 rounded-lg border bg-transparent px-4 py-3"
        />
        <button className="bg-primary text-primary-foreground rounded-lg px-5">搜索</button>
      </form>
      {!result ? (
        <p role="alert" className="mt-6">
          搜索参数无效，请输入不超过200字的关键词。
        </p>
      ) : (
        <>
          <nav aria-label="搜索类型" className="my-6 flex flex-wrap gap-2">
            {Object.entries(types).map(([key, label]) => (
              <Link
                key={key}
                href={href({ type: key, page: '1' })}
                aria-current={type === key ? 'page' : undefined}
                className={
                  type === key
                    ? 'bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm'
                    : 'bg-muted rounded-full px-4 py-2 text-sm'
                }
              >
                {label}{' '}
                {key === 'all'
                  ? Object.values(result.meta.typeCounts).reduce((sum, n) => sum + n, 0)
                  : result.meta.typeCounts[key as keyof typeof result.meta.typeCounts]}
              </Link>
            ))}
          </nav>
          <p className="text-muted-foreground text-sm">
            {q.trim().length < 2
              ? '输入至少两个字符开始搜索。'
              : `找到 ${result.meta.total} 条内容`}
          </p>
          <div className="divide-y">
            {result.data.map((item) => (
              <article key={item.type + item.id} className="min-w-0 py-7 break-words">
                <p className="text-muted-foreground text-xs">
                  {types[item.type]} · {formatDate(item.publishedAt)}
                </p>
                <h2 className="my-3 text-xl font-semibold">
                  <Link href={item.url}>{item.title}</Link>
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  {searchHighlightParts(item.excerpt).map((part, i) =>
                    part.highlight ? (
                      <mark key={i} className="bg-brand-soft text-brand">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </p>
              </article>
            ))}
            {q.trim().length >= 2 && !result.data.length && (
              <p className="py-12 text-center">没有找到相关内容，试试其他关键词。</p>
            )}
          </div>
          <nav aria-label="分页" className="mt-8 flex justify-between gap-3 text-sm">
            {result.meta.hasPrev ? (
              <Link href={href({ page: String(result.meta.page - 1) })}>← 上一页</Link>
            ) : (
              <span />
            )}
            <span>
              第 {result.meta.page} 页 · 共 {result.meta.total} 条
            </span>
            {result.meta.hasNext ? (
              <Link href={href({ page: String(result.meta.page + 1) })}>下一页 →</Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </div>
  )
}
