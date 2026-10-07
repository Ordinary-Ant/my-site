'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
type Event = {
  id: string
  resource: string
  resourceId: string | null
  action: string
  createdAt: string
  user: { name: string } | null
  before: unknown
  after: unknown
}
/** 审计只读展示已脱敏差异，模块撤销另走带有效期的专门入口。 */
export function AuditViewer() {
  const user = useAdminUser()
  const [events, setEvents] = useState<Event[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [filter, setFilter] = useState('')
  const [resource, setResource] = useState('')
  const [action, setAction] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!user?.permissions.includes('audit:read')) return
    let active = true
    setMessage('正在读取审计记录…')
    void api<Event[]>('/api/v1/admin/audit-logs?page=' + page + '&' + filter)
      .then((result) => {
        if (active) {
          setEvents(result.data)
          setPages(result.meta?.totalPages ?? 1)
          setMessage('')
        }
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message)
      })
    return () => {
      active = false
    }
  }, [page, filter, user])
  if (!user?.permissions.includes('audit:read'))
    return <p role="alert">当前账号没有审计查看权限。</p>
  return (
    <div>
      <h1 className="text-2xl font-bold">审计日志</h1>
      <p className="text-muted-foreground mt-3">查看谁在何时修改了哪些内容与配置。</p>
      <form
        className="my-6 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const query = new URLSearchParams()
          if (resource) query.set('resource', resource)
          if (action) query.set('action', action)
          if (userId) query.set('userId', userId)
          if (from) query.set('from', new Date(from).toISOString())
          if (to) query.set('to', new Date(to).toISOString())
          setPage(1)
          setFilter(query.toString())
        }}
      >
        <label className="text-sm">
          资源
          <select
            aria-label="资源"
            className="bg-background ml-2 rounded border px-3 py-2"
            value={resource}
            onChange={(event) => setResource(event.target.value)}
          >
            <option value="">全部</option>
            {[
              'module',
              'setting',
              'article',
              'log',
              'project',
              'timeline',
              'profile',
              'media',
              'user',
              'session',
            ].map((key) => (
              <option key={key} value={key}>
                {
                  (
                    {
                      module: '模块',
                      setting: '设置',
                      article: '文章',
                      log: '日志',
                      project: '作品',
                      timeline: '时间戳',
                      profile: '个人资料',
                      media: '媒体',
                      user: '用户',
                      session: '会话',
                    } as Record<string, string>
                  )[key]
                }
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          操作
          <input
            className="bg-background ml-2 w-32 rounded border px-3 py-2"
            value={action}
            placeholder="update / toggle"
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className="text-sm">
          用户ID
          <input
            className="bg-background ml-2 w-40 rounded border px-3 py-2"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <label className="text-sm">
          开始时间
          <input
            type="datetime-local"
            className="bg-background ml-2 rounded border px-3 py-2"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="text-sm">
          结束时间
          <input
            type="datetime-local"
            className="bg-background ml-2 rounded border px-3 py-2"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm">
          筛选
        </button>
      </form>
      <p role="status" className="my-4 text-sm">
        {message}
      </p>
      <div className="space-y-3">
        {events.map((event) => (
          <article key={event.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap justify-between gap-3 text-sm">
              <span>
                {event.user?.name ?? '系统'} · {event.resource} · {event.action} ·{' '}
                {event.resourceId}
              </span>
              <time dateTime={event.createdAt} className="text-muted-foreground">
                {new Date(event.createdAt).toLocaleString('zh-CN')}
              </time>
            </div>
            <details className="mt-3">
              <summary className="text-brand cursor-pointer text-sm">查看变更前后</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <h2 className="text-xs font-semibold">变更前</h2>
                  <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-lg p-3 text-xs break-words whitespace-pre-wrap">
                    {JSON.stringify(event.before, null, 2)}
                  </pre>
                </div>
                <div>
                  <h2 className="text-xs font-semibold">变更后</h2>
                  <pre className="bg-muted mt-2 max-h-80 overflow-auto rounded-lg p-3 text-xs break-words whitespace-pre-wrap">
                    {JSON.stringify(event.after, null, 2)}
                  </pre>
                </div>
              </div>
            </details>
          </article>
        ))}
      </div>
      {!events.length && !message && (
        <p className="text-muted-foreground py-8 text-center">暂无符合条件的记录</p>
      )}
      <div className="mt-6 flex justify-between">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          {page} / {Math.max(1, pages)}
        </span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  )
}
