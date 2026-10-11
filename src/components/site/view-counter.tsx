'use client'
import { useEffect, useState } from 'react'
/** 阅读上报不阻塞正文；存储只是优化，真正去重由数据库完成。 */
export function ViewCounter({
  resource,
  id,
  initialCount = 0,
  visible = true,
}: {
  resource: 'article' | 'log' | 'project'
  id: string
  initialCount?: number
  visible?: boolean
}) {
  const [count, setCount] = useState(initialCount)
  useEffect(() => {
    if (
      navigator.doNotTrack === '1' ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
    )
      return
    const key = `view:${resource}:${id}`
    try {
      const last = Number(sessionStorage.getItem(key))
      if (last > 0 && Date.now() - last >= 0 && Date.now() - last < 1800000) return
    } catch {
      /* 禁用存储时仍由服务端去重。 */
    }
    let mounted = true
    void fetch('/api/v1/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ resource, id }),
    })
      .then(async (response) => {
        if (!response.ok) return
        const payload = (await response.json()) as {
          success: boolean
          data?: { counted: boolean; viewCount: number | null }
        }
        if (!payload.success || !payload.data) return
        if (mounted && typeof payload.data.viewCount === 'number') setCount(payload.data.viewCount)
        if (payload.data.counted)
          try {
            sessionStorage.setItem(key, String(Date.now()))
          } catch {
            /* 正文与成功上报不依赖存储。 */
          }
      })
      .catch(() => {
        /* 网络失败静默，下一次访问仍可重试。 */
      })
    return () => {
      mounted = false
    }
  }, [resource, id])
  return visible ? (
    <span className="text-muted-foreground text-xs" aria-label="阅读量">
      {count} 次阅读
    </span>
  ) : null
}
