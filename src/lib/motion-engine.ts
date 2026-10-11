import { animate, createScope } from 'animejs'
import type { MotionConfig } from '@/config/motion'

/** 仅离屏目标需要JS编排；首屏、失败和关闭时始终保留正文。 */
export function mountMotion(
  root: HTMLElement,
  config: MotionConfig,
  intensity: 'subtle' | 'standard',
  targets: HTMLElement[],
) {
  root.dataset.motionEngine = 'active'
  const scope = createScope({ root })
  const active = new Map<HTMLElement, ReturnType<typeof animate>>()
  let disposed = false,
    stopped = false,
    frame = 0,
    last = 0
  const intervals: number[] = []
  const visible = () => {
    for (const animation of active.values()) animation.revert()
    active.clear()
  }
  const stop = () => {
    stopped = true
    root.dataset.motion = 'off'
    observer.disconnect()
    cancelAnimationFrame(frame)
    visible()
    scope.revert()
    delete root.dataset.motionEngine
  }
  // 只在有限动画正在运行时测帧，低帧率停止编排，不保留常驻rAF。
  const sample = (now: number) => {
    if (disposed || stopped || document.hidden || !active.size) {
      frame = 0
      last = 0
      intervals.length = 0
      return
    }
    if (last) {
      intervals.push(now - last)
      if (intervals.length > 12) intervals.shift()
    }
    last = now
    if (intervals.length === 12 && intervals.reduce((sum, value) => sum + value, 0) / 12 > 34) {
      stop()
      return
    }
    frame = requestAnimationFrame(sample)
  }
  const observer = new IntersectionObserver(
    (entries) => {
      let index = 0
      for (const entry of entries) {
        if (!entry.isIntersecting || stopped || disposed || document.hidden) continue
        const element = entry.target as HTMLElement
        observer.unobserve(element)
        if (element.contains(document.activeElement)) continue
        try {
          scope.add(() => {
            const distance =
              intensity === 'subtle'
                ? 6
                : config.preset === 'kinetic'
                  ? 24
                  : config.preset === 'narrative'
                    ? 16
                    : 10
            const animation = animate(element, {
              opacity: [0, 1],
              translateY: [distance, 0],
              duration:
                intensity === 'subtle'
                  ? Math.min(config.reveal.duration, 300)
                  : config.reveal.duration,
              delay: Math.min(index++, 4) * config.reveal.stagger,
              ease: 'out(3)',
              onComplete: () => {
                active.delete(element)
                animation.revert()
              },
            })
            active.set(element, animation)
          })
        } catch {
          stop()
          break
        }
      }
      if (active.size && !frame) frame = requestAnimationFrame(sample)
    },
    { threshold: 0.08 },
  )
  for (const target of targets) observer.observe(target)
  const focus = (event: FocusEvent) => {
    for (const [element, animation] of active)
      if (element.contains(event.target as Node)) {
        animation.revert()
        active.delete(element)
      }
  }
  const visibility = () => {
    for (const animation of active.values())
      if (document.hidden) animation.pause()
      else animation.resume()
    cancelAnimationFrame(frame)
    frame = 0
    last = 0
    intervals.length = 0
    if (!document.hidden && active.size && !stopped) frame = requestAnimationFrame(sample)
  }
  root.addEventListener('focusin', focus)
  document.addEventListener('visibilitychange', visibility)
  return () => {
    disposed = true
    observer.disconnect()
    cancelAnimationFrame(frame)
    root.removeEventListener('focusin', focus)
    document.removeEventListener('visibilitychange', visibility)
    visible()
    scope.revert()
    delete root.dataset.motionEngine
  }
}
