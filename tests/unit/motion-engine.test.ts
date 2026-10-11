import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_MOTION } from '@/config/motion'
import { mountMotion } from '@/lib/motion-engine'
const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  revert: vi.fn(),
  scopeRevert: vi.fn(),
  fail: false,
}))
vi.mock('animejs', () => ({
  createScope: () => ({ add: (callback: () => void) => callback(), revert: mocks.scopeRevert }),
  animate: () => {
    if (mocks.fail) throw new Error('编排故障')
    return { pause: mocks.pause, resume: mocks.resume, revert: mocks.revert }
  },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
function host() {
  const listeners: Record<string, () => void> = {},
    frames = new Map<number, FrameRequestCallback>()
  let sequence = 0,
    intersection: IntersectionObserverCallback | undefined
  const disconnect = vi.fn(),
    document = {
      hidden: false,
      activeElement: null,
      addEventListener: (event: string, callback: () => void) => {
        listeners[event] = callback
      },
      removeEventListener: vi.fn(),
    }
  vi.stubGlobal('document', document)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const root = {
    dataset: {} as Record<string, string>,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement
  const target = { contains: () => false } as unknown as HTMLElement
  const cleanup = mountMotion(root, DEFAULT_MOTION, 'standard', [target])
  intersection!(
    [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
  return { root, cleanup, document, listeners, frames, disconnect }
}
test('低帧率停用编排并恢复内容，清理后没有待执行帧', () => {
  const h = host()
  for (let index = 1; index <= 14; index++) {
    const pending = [...h.frames]
    h.frames.clear()
    for (const [, callback] of pending) callback(index * 40)
  }
  expect(h.root.dataset.motion).toBe('off')
  expect(mocks.revert).toHaveBeenCalled()
  expect(h.disconnect).toHaveBeenCalled()
  h.cleanup()
  expect(h.frames.size).toBe(0)
  expect(mocks.scopeRevert).toHaveBeenCalled()
  expect(h.root.dataset.motionEngine).toBeUndefined()
})
test('隐藏页暂停实例与采样，恢复后继续，卸载清除监听', () => {
  const h = host()
  h.document.hidden = true
  h.listeners.visibilitychange()
  expect(mocks.pause).toHaveBeenCalled()
  expect(h.frames.size).toBe(0)
  h.document.hidden = false
  h.listeners.visibilitychange()
  expect(mocks.resume).toHaveBeenCalled()
  expect(h.frames.size).toBe(1)
  h.cleanup()
  expect(h.document.removeEventListener).toHaveBeenCalledWith(
    'visibilitychange',
    expect.any(Function),
  )
  expect(h.frames.size).toBe(0)
})

test('运行时异常降级而不向页面传播', () => {
  mocks.fail = true
  try {
    expect(() => {
      const h = host()
      expect(h.root.dataset.motion).toBe('off')
      h.cleanup()
    }).not.toThrow()
  } finally {
    mocks.fail = false
  }
})

test('正常帧之后连续低帧仍能降级，不受之前快速帧稀释', () => {
  const h = host()
  let time = 1
  for (let i = 0; i < 100; i++) {
    time += 16
    const pending = [...h.frames]
    h.frames.clear()
    for (const [, cb] of pending) cb(time)
  }
  for (let i = 0; i < 12; i++) {
    time += 50
    const pending = [...h.frames]
    h.frames.clear()
    for (const [, cb] of pending) cb(time)
  }
  expect(h.root.dataset.motion).toBe('off')
  h.cleanup()
})
