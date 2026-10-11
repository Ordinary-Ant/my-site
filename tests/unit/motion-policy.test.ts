import { expect, test } from 'vitest'
import { DEFAULT_MOTION } from '@/config/motion'
import { effectiveMotion } from '@/lib/motion-policy'
test('系统减弱和主动关闭始终优先', () => {
  expect(
    effectiveMotion(DEFAULT_MOTION, {
      reduce: true,
      preference: 'full',
      mobile: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }),
  ).toBe('off')
  expect(effectiveMotion(DEFAULT_MOTION, { reduce: false, preference: 'off', mobile: false })).toBe(
    'off',
  )
})
test('移动与未知能力保守降档，static永远不动', () => {
  expect(
    effectiveMotion(DEFAULT_MOTION, {
      reduce: false,
      preference: 'auto',
      mobile: true,
      hardwareConcurrency: 8,
    }),
  ).toBe('subtle')
  expect(
    effectiveMotion(DEFAULT_MOTION, { reduce: false, preference: 'full', mobile: false }),
  ).toBe('subtle')
  expect(
    effectiveMotion(DEFAULT_MOTION, {
      reduce: false,
      preference: 'full',
      mobile: false,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    }),
  ).toBe('standard')
  expect(
    effectiveMotion(
      { ...DEFAULT_MOTION, preset: 'static' },
      { reduce: false, preference: 'full', mobile: false, hardwareConcurrency: 8 },
    ),
  ).toBe('off')
  expect(
    effectiveMotion(DEFAULT_MOTION, {
      reduce: false,
      preference: 'auto',
      mobile: false,
      saveData: true,
      hardwareConcurrency: 8,
    }),
  ).toBe('subtle')
})
