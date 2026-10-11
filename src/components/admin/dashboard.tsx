'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
import type { getAdminStats } from '@/lib/services/stats'
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
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getAdminStats>> | null>(null)
  useEffect(() => {
    void api<Awaited<ReturnType<typeof getAdminStats>>>('/api/v1/admin/stats')
      .then((result) => {
        const value = result.data
        setDetails(value)
        setStats({
          articles: value.counts.articles.total,
          drafts: value.counts.articles.draft,
          logs: value.counts.logs.total,
          projects: value.counts.projects.total,
          media: value.counts.media.total,
          recent: value.recent.articles,
        })
      })
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
      {details && (
        <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-2">
          <section className="min-w-0 rounded-xl border p-5">
            <h2 className="font-semibold">最近7日阅读</h2>
            <p className="text-muted-foreground my-3 text-sm">
              {details.recent.viewsLast7Days} 次阅读 · 新增 {details.recent.newContentLast7Days}{' '}
              条内容
            </p>
            <table className="w-full text-sm">
              <caption className="sr-only">北京时间每日成功计数阅读量</caption>
              <thead>
                <tr>
                  <th className="py-2 text-left">日期</th>
                  <th className="text-right">阅读量</th>
                </tr>
              </thead>
              <tbody>
                {details.traffic.map((day) => (
                  <tr key={day.date} className="border-t">
                    <td className="py-2">{day.date}</td>
                    <td className="text-right">{day.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="min-w-0 rounded-xl border p-5">
            <h2 className="font-semibold">热门公开文章</h2>
            <ol className="mt-4 space-y-4">
              {details.recent.topArticles.map((item) => (
                <li key={item.id} className="flex min-w-0 justify-between gap-3">
                  <Link href={item.url} className="min-w-0 break-words">
                    {item.title}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-sm">{item.viewCount}</span>
                </li>
              ))}
            </ol>
            {!details.recent.topArticles.length && (
              <p className="text-muted-foreground mt-4 text-sm">暂无公开文章。</p>
            )}
          </section>
          <section className="rounded-xl border p-5 text-sm lg:col-span-2">
            <h2 className="mb-3 font-semibold">系统状态</h2>
            <p>
              数据库已连接 · 启用栏目 {details.system.modulesEnabled} · 关闭栏目{' '}
              {details.system.modulesDisabled}
            </p>
            <p className="text-muted-foreground mt-2">
              最近备份：{details.system.lastBackupAt ?? '尚无已验证备份'}
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
