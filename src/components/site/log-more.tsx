'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { LOG_TYPES, MOODS } from '@/lib/log-display'
import { safeContentUrl } from '@/lib/markdown'
type Row = {
  id: string
  title: string
  logDate: string
  type: keyof typeof LOG_TYPES
  summary: string | null
  isPinned: boolean
  mood: string | null
  coverImage: string | null
  tags: { id: string; slug: string; name: string }[]
}
/** 移动端追加新页；原生链接保留无JS兜底，失败仍可重试当前页。 */
export function LogMore({
  route,
  query,
  page,
  hasNext,
  lastMonth,
}: {
  route: string
  query: string
  page: number
  hasNext: boolean
  lastMonth: string
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [currentPage, setCurrentPage] = useState(page),
    [more, setMore] = useState(hasNext),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const next = new URLSearchParams(query)
  next.set('page', String(currentPage + 1))
  next.delete('view')
  const storageKey = 'log-pages:' + route + '?' + query
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const target = Number(sessionStorage.getItem(storageKey))
        if (!Number.isInteger(target) || target <= page || target > page + 100) return
        setBusy(true)
        const restored: Row[] = []
        let latestPage = page,
          remaining = hasNext
        for (let index = page + 1; index <= target && remaining; index++) {
          const params = new URLSearchParams(query)
          params.set('page', String(index))
          // 只记页数，返回时重新读取公开接口，避免本机缓存绕过开关或隐私变更。
          const result = await api<Row[]>('/api/v1/logs?' + params)
          if (!active) return
          restored.push(...result.data)
          latestPage = index
          remaining = (result.meta?.page ?? index) < (result.meta?.totalPages ?? 0)
        }
        if (!active) return
        setRows(
          restored.filter(
            (row, index) => restored.findIndex((item) => item.id === row.id) === index,
          ),
        )
        setCurrentPage(latestPage)
        setMore(remaining)
        const saved = JSON.parse(sessionStorage.getItem('log-return') ?? 'null')
        if (saved?.list === location.pathname + location.search && Number.isFinite(saved.scroll))
          requestAnimationFrame(() => window.scrollTo({ top: saved.scroll, behavior: 'instant' }))
      } catch (error) {
        if (active) setMessage('恢复列表未成功，可重新加载：' + (error as Error).message)
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
    }
  }, [storageKey, page, hasNext, query])
  let group = lastMonth
  return (
    <div className="sm:hidden">
      {rows.map((row) => {
        const month = row.logDate.slice(0, 7),
          heading = month !== group
        group = month
        return (
          <section key={row.id}>
            {heading && (
              <h2 className="text-muted-foreground mt-8 border-b pb-3 text-sm">
                {month.replace('-', '年')}月
              </h2>
            )}
            <article className="relative border-b py-6">
              {row.coverImage && safeContentUrl(row.coverImage) && (
                <Image
                  src={safeContentUrl(row.coverImage)!}
                  alt={row.title + '封面'}
                  width={800}
                  height={450}
                  unoptimized
                  className="mb-4 aspect-video w-full rounded-xl object-cover"
                />
              )}
              <p className="text-muted-foreground text-sm">
                {row.logDate} · {LOG_TYPES[row.type]}
                {row.mood && ' · ' + (MOODS[row.mood as keyof typeof MOODS] ?? row.mood)}
              </p>
              <h3 className="my-3 text-xl font-semibold">
                <Link
                  href={route + '/' + row.id}
                  className="hover:text-brand after:absolute after:inset-0 focus-visible:after:rounded-lg focus-visible:after:outline-2"
                >
                  {row.isPinned && '📌 '}
                  {row.title}
                </Link>
              </h3>
              {row.summary && (
                <p className="text-muted-foreground line-clamp-2 leading-relaxed">{row.summary}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {row.tags.map((tag) => {
                  const filter = new URLSearchParams(query)
                  filter.set('tag', tag.slug)
                  filter.delete('page')
                  filter.set('view', 'list')
                  return (
                    <Link
                      key={tag.id}
                      href={route + '?' + filter}
                      className="bg-muted relative z-10 rounded-full px-2 py-1 text-xs"
                    >
                      {tag.name}
                    </Link>
                  )
                })}
              </div>
            </article>
          </section>
        )
      })}
      <p role="status" className="mt-4 text-center text-sm">
        {message}
      </p>
      {more && (
        <a
          className="text-brand mt-4 block rounded-lg border p-3 text-center text-sm"
          href={route + '?' + next + '&view=list'}
          aria-disabled={busy}
          onClick={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            try {
              const result = await api<Row[]>('/api/v1/logs?' + next)
              setRows((previous) => {
                const ids = new Set(previous.map((row) => row.id))
                return [...previous, ...result.data.filter((row) => !ids.has(row.id))]
              })
              setCurrentPage(currentPage + 1)
              try {
                sessionStorage.setItem(storageKey, String(currentPage + 1))
              } catch {}
              setMore((result.meta?.page ?? currentPage + 1) < (result.meta?.totalPages ?? 0))
              setMessage('已加载更多日志')
            } catch (error) {
              setMessage((error as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '正在加载…' : '加载更多 →'}
        </a>
      )}
    </div>
  )
}
