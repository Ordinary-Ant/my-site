'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
type Stats = {
  articles: number
  drafts: number
  logs: number
  projects: number
  media: number
  recent: { id: string; title: string; status: string }[]
}
/** 概览只有实际数据；请求失败保留错误状态，不展示伪零值。 */
export function Dashboard() {
  const user = useAdminUser()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    void api<Stats>('/api/v1/admin/dashboard')
      .then((result) => setStats(result.data))
      .catch((error) => setError((error as Error).message))
  }, [])
  return (
    <div>
      <header className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">仪表盘</h1>
          <p className="text-muted-foreground mt-3">
            欢迎回来，{user?.name}。从这里维护你的个人网站。
          </p>
        </div>
        {user?.permissions.includes('content:write') && (
          <div className="flex gap-4">
            <Link href="/admin/logs?quick=1" className="text-brand">
              记一笔
            </Link>
            <Link href="/admin/articles/new" className="text-brand">
              写一篇文章 +
            </Link>
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="text-destructive mt-5">
          {error}
        </p>
      )}
      {!stats && !error && <p className="mt-5">正在读取统计…</p>}
      {stats && (
        <>
          <div className="my-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
            {(
              [
                ['文章', stats.articles],
                ['待发布草稿', stats.drafts],
                ['日志', stats.logs],
                ['作品', stats.projects],
                ['媒体文件', stats.media],
              ] as const
            ).map(([name, count]) => (
              <div key={name} className="rounded-xl border p-5">
                <p className="text-muted-foreground text-sm">{name}</p>
                <p className="mt-3 text-3xl font-semibold">{count}</p>
              </div>
            ))}
          </div>
          <section className="rounded-xl border p-5">
            <h2 className="mb-4 font-semibold">最近编辑的文章</h2>
            <div className="divide-y">
              {stats.recent.map((article) => (
                <Link
                  key={article.id}
                  href={`/admin/articles/${article.id}`}
                  className="flex justify-between gap-4 py-4"
                >
                  <span>{article.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{article.status}</span>
                </Link>
              ))}
            </div>
            {!stats.recent.length && (
              <p className="text-muted-foreground">还没有文章，从第一篇草稿开始。</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
