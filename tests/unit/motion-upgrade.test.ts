import { expect, test } from 'vitest'
import {
  DEFAULT_MOTION,
  MOTION_PRESETS,
  motionSchema,
  readMotionConfig,
  upgradeMotionV1,
} from '@/config/motion'

test('四预设都是完整合法模板，static关闭所有编排', () => {
  expect(Object.keys(MOTION_PRESETS)).toEqual(['static', 'editorial', 'narrative', 'kinetic'])
  for (const config of Object.values(MOTION_PRESETS))
    expect(motionSchema.parse(config)).toEqual(config)
  expect(MOTION_PRESETS.static).toMatchObject({
    intensity: 'off',
    reveal: { enabled: false },
    interaction: { cardHover: 'none', linkHover: 'none' },
    decoration: { type: 'none' },
  })
  expect(MOTION_PRESETS.editorial).toEqual(DEFAULT_MOTION)
})

test('v1只保留合法值并收敛时长，去掉未知旧字段且不修改输入', () => {
  const old = {
    version: 1,
    preset: 'aurora',
    intensity: 'subtle',
    mobileIntensity: 'off',
    autoDegrade: false,
    respectReducedMotion: false,
    background: { type: 'particles' },
    cursor: true,
    reveal: { enabled: false, duration: 9000, stagger: -10, unknown: true },
    decoration: { type: 'tint', opacity: 0.1 },
    interaction: { cardHover: 'tilt' },
  }
  const snapshot = structuredClone(old)
  expect(upgradeMotionV1(old)).toEqual({
    ...DEFAULT_MOTION,
    intensity: 'subtle',
    mobileIntensity: 'off',
    autoDegrade: false,
    respectReducedMotion: true,
    decoration: { type: 'none', opacity: 0 },
    reveal: { enabled: false, duration: 800, stagger: 0 },
  })
  expect(old).toEqual(snapshot)
})

test('minimal映射static，其余预设editorial；非法旧字段回退合法默认', () => {
  expect(upgradeMotionV1({ version: 1, preset: 'minimal' })).toMatchObject({
    preset: 'static',
    intensity: 'off',
    reveal: { enabled: false },
    decoration: { type: 'none', opacity: 0 },
  })
  expect(
    upgradeMotionV1({
      version: 1,
      preset: 'future',
      intensity: 'heavy',
      autoDegrade: 'false',
      reveal: { duration: NaN, stagger: Infinity },
    }),
  ).toEqual({ ...DEFAULT_MOTION, decoration: { type: 'none', opacity: 0 } })
})

test('公开解析升级v1，非法v2安全回退而不透传未知字段', () => {
  expect(readMotionConfig({ version: 1, preset: 'minimal', secret: 'old' }).preset).toBe('static')
  expect(readMotionConfig({ ...DEFAULT_MOTION, unknown: 'private' })).toEqual(DEFAULT_MOTION)
  expect(readMotionConfig(null)).toEqual(DEFAULT_MOTION)
})
