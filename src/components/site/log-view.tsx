'use client'
import Link from 'next/link'
import { useEffect } from 'react'

/** 只在URL未指定视图时恢复偏好，分享链接优先于本机记忆。 */
export function LogView({ route, query, view }: { route: string; query: string; view: string }) {
  useEffect(() => {
    const params = new URLSearchParams(query)
    if (params.has('view')) return
    try {
      const saved = localStorage.getItem('log-public-view')
      if ((saved === 'list' || saved === 'calendar') && saved !== view) {
        params.set('view', saved)
        location.replace(route + '?' + params)
      }
    } catch {}
  }, [route, query, view])
  return (
    <nav aria-label="日志视图" className="mb-6 flex gap-4 text-sm">
      {['list', 'calendar'].map((mode) => {
        const next = new URLSearchParams(query)
        next.set('view', mode)
        next.delete('date')
        next.delete('page')
        return (
          <Link
            key={mode}
            href={route + '?' + next}
            aria-current={mode === view ? 'page' : undefined}
            onClick={() => {
              try {
                localStorage.setItem('log-public-view', mode)
              } catch {}
            }}
          >
            {mode === 'list' ? '列表' : '日历'}
          </Link>
        )
      })}
    </nav>
  )
}
