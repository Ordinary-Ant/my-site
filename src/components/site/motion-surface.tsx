'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import type { MotionConfig } from '@/config/motion'
import { effectiveMotion, type MotionPreference } from '@/lib/motion-policy'

/** 前台和后台预览共用同一边界，偏好改变和路由切换都会清理实例。 */
export function MotionSurface({
  config,
  children,
  preview = false,
}: {
  config: MotionConfig
  children: React.ReactNode
  preview?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const path = usePathname()
  const [preference, setPreference] = useState<MotionPreference | null>(preview ? 'auto' : null)
  const [intensity, setIntensity] = useState<'off' | 'subtle' | 'standard'>('off')
  useEffect(() => {
    if (preview) return
    const restore = () => {
      try {
        const saved = localStorage.getItem('site-motion-preference')
        setPreference(saved === 'off' || saved === 'full' ? saved : 'auto')
      } catch {
        setPreference('auto')
      }
    }
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'site-motion-preference') restore()
    }
    restore()
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [preview])
  useEffect(() => {
    const element = root.current
    if (!element || preference === null) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)'),
      mobile = matchMedia('(max-width: 767px)')
    let disposed = false,
      revision = 0,
      cleanup: (() => void) | undefined,
      observer: IntersectionObserver | undefined
    const refresh = () => {
      const current = ++revision
      cleanup?.()
      cleanup = undefined
      observer?.disconnect()
      const nav = navigator as Navigator & {
        deviceMemory?: number
        connection?: { saveData?: boolean }
      }
      const value = effectiveMotion(config, {
        reduce: reduce.matches,
        mobile: mobile.matches,
        preference,
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        saveData: nav.connection?.saveData,
      })
      setIntensity(value)
      element.dataset.motion = value
      if (value === 'off' || !config.reveal.enabled || !('IntersectionObserver' in window)) return
      const targets = [
        ...element.querySelectorAll<HTMLElement>('[data-motion="section"], [data-motion="card"]'),
      ].filter((target) => target.getBoundingClientRect().top > innerHeight)
      // 直到离屏区块进入视口才下载编排库；首屏不等待JS。
      observer = new IntersectionObserver((entries) => {
        if (disposed || current !== revision || !entries.some((entry) => entry.isIntersecting))
          return
        observer?.disconnect()
        void import('@/lib/motion-engine')
          .then(({ mountMotion }) => {
            if (!disposed && current === revision)
              cleanup = mountMotion(element, config, value, targets)
          })
          .catch(() => {
            if (!disposed && current === revision) {
              element.dataset.motion = 'off'
              setIntensity('off')
            }
          })
      })
      for (const target of targets) observer.observe(target)
    }
    refresh()
    reduce.addEventListener('change', refresh)
    mobile.addEventListener('change', refresh)
    return () => {
      disposed = true
      revision++
      observer?.disconnect()
      cleanup?.()
      reduce.removeEventListener('change', refresh)
      mobile.removeEventListener('change', refresh)
    }
  }, [config, path, preference])
  const choose = (value: MotionPreference) => {
    setPreference(value)
    if (!preview)
      try {
        localStorage.setItem('site-motion-preference', value)
      } catch {
        /* 偏好仍在当前页生效。 */
      }
  }
  return (
    <div
      ref={root}
      className="site-motion"
      data-motion={intensity}
      data-preset={config.preset}
      data-decoration={config.decoration.type}
      data-card-hover={config.interaction.cardHover}
      data-link-hover={config.interaction.linkHover}
      style={
        {
          '--motion-tint': `${config.decoration.opacity * 100}%`,
          '--motion-duration': `${config.reveal.duration}ms`,
        } as CSSProperties
      }
    >
      {children}
      <div className={'container-page py-4 text-sm' + (preview ? '' : ' motion-preferences')}>
        <label>
          动态效果{' '}
          <select
            aria-label={preview ? '预览动态偏好' : '动态效果偏好'}
            value={preference ?? 'auto'}
            onChange={(event) => choose(event.target.value as MotionPreference)}
            className="bg-background ml-2 rounded-lg border px-2 py-1"
          >
            <option value="auto">跟随站点</option>
            <option value="full">完整动效</option>
            <option value="off">关闭动效</option>
          </select>
        </label>
        <span className="text-muted-foreground ml-3">始终尊重系统减弱动态效果</span>
      </div>
    </div>
  )
}
