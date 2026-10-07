'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState } from 'react'
import { api, refreshSession } from '@/lib/api/client'
import type { SessionUser } from '@/lib/services/auth'
const nav = [
  ['/admin', '仪表盘'],
  ['/admin/articles', '文章'],
  ['/admin/logs', '日志'],
  ['/admin/projects', '作品集'],
  ['/admin/timeline', '时间戳'],
  ['/admin/profile', '关于我'],
  ['/admin/categories', '分类'],
  ['/admin/tags', '标签'],
  ['/admin/media', '媒体库'],
  ['/admin/account', '个人设置'],
]
const adminNav = [
  ['/admin/modules', '模块开关'],
  ['/admin/settings/general', '站点设置'],
  ['/admin/settings/motion', '动效设置'],
  ['/admin/users', '用户管理'],
  ['/admin/data', '数据管理'],
]
const UserContext = createContext<SessionUser | null>(null)
export const useAdminUser = () => useContext(UserContext)
/** AT过期先去重刷新，失效再登录；角色仅控制展示，权限仍由服务器校验。 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!(await refreshSession())) throw new Error('expired')
        const result = await api<SessionUser>('/api/v1/auth/me')
        if (active) setUser(result.data)
      } catch {
        location.replace(`/login?next=${encodeURIComponent(path)}`)
      }
    })()
    return () => {
      active = false
    }
  }, [path])
  if (!user)
    return (
      <main className="p-8" aria-live="polite">
        正在验证会话…
      </main>
    )
  const items = [
    ...nav,
    ...(user.role === 'ADMIN' ? adminNav : []),
    ...(user.permissions.includes('audit:read') ? [['/admin/audit-logs', '审计日志']] : []),
  ]
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="bg-surface-subtle border-b p-5 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r">
        <Link href="/admin" className="text-lg font-bold">
          个人网站 · 管理
        </Link>
        <nav className="mt-5 flex gap-1 overflow-x-auto lg:flex-col" aria-label="管理导航">
          {items.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm ${path === href ? 'bg-brand-soft text-brand font-medium' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 text-sm">
          <Link href="/" target="_blank">
            查看网站 ↗
          </Link>
          <div className="flex items-center gap-4">
            <span>
              {user.name} · {user.role}
            </span>
            <button
              onClick={async () => {
                await api('/api/v1/auth/logout', { method: 'POST' })
                location.assign('/login')
              }}
            >
              退出登录
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">
          <UserContext.Provider value={user}>{children}</UserContext.Provider>
        </main>
      </div>
    </div>
  )
}
