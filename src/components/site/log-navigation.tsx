'use client'
import { useEffect } from 'react'

/** 记录从列表进入详情的地址与位置，SPA导航不依赖document.referrer。 */
export function LogNavigation({ route }: { route: string }) {
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('log-return') ?? 'null')
      if (saved?.list === location.pathname + location.search && Number.isFinite(saved.scroll))
        requestAnimationFrame(() => window.scrollTo({ top: saved.scroll, behavior: 'instant' }))
    } catch {}
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const target = new URL(anchor.href)
      if (target.origin !== location.origin || !target.pathname.startsWith(route + '/')) return
      try {
        sessionStorage.setItem(
          'log-return',
          JSON.stringify({
            list: location.pathname + location.search,
            detail: target.pathname,
            scroll: scrollY,
          }),
        )
      } catch {}
    }
    document.addEventListener('click', click, true)
    return () => document.removeEventListener('click', click, true)
  }, [route])
  return null
}
