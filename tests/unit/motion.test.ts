import { expect, test } from 'vitest'
import { DEFAULT_MOTION, motionSchema } from '@/config/motion'

test('默认 editorial 无装饰且保留减弱动态偏好', () => {
  expect(motionSchema.parse(DEFAULT_MOTION)).toMatchObject({
    version: 2,
    preset: 'editorial',
    decoration: { type: 'none' },
    respectReducedMotion: true,
  })
  expect(motionSchema.safeParse({ ...DEFAULT_MOTION, preset: 'breath' }).success).toBe(false)
  expect(
    motionSchema.safeParse({ ...DEFAULT_MOTION, decoration: { type: 'particles', opacity: 0.06 } })
      .success,
  ).toBe(false)
  expect(motionSchema.safeParse({ ...DEFAULT_MOTION, respectReducedMotion: false }).success).toBe(
    false,
  )
})
