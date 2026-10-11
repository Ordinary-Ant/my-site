import { z } from 'zod'

/** 一期动效合同：编排与静态装饰独立，禁止常驻动画背景。 */
export const motionSchema = z
  .object({
    version: z.literal(2),
    preset: z.enum(['static', 'editorial', 'narrative', 'kinetic']),
    intensity: z.enum(['off', 'subtle', 'standard']).default('standard'),
    respectReducedMotion: z.literal(true),
    mobileIntensity: z.enum(['off', 'subtle']).default('subtle'),
    autoDegrade: z.boolean(),
    decoration: z
      .object({ type: z.enum(['none', 'tint']), opacity: z.number().min(0).max(0.15) })
      .strict(),
    reveal: z
      .object({
        enabled: z.boolean(),
        duration: z.number().int().min(150).max(800),
        stagger: z.number().int().min(0).max(100),
      })
      .strict(),
    interaction: z
      .object({ cardHover: z.enum(['none', 'lift']), linkHover: z.enum(['none', 'underline']) })
      .strict(),
  })
  .strict()

export type MotionConfig = z.infer<typeof motionSchema>
export const DEFAULT_MOTION: MotionConfig = {
  version: 2,
  preset: 'editorial',
  intensity: 'standard',
  respectReducedMotion: true,
  mobileIntensity: 'subtle',
  autoDegrade: true,
  decoration: { type: 'none', opacity: 0.06 },
  reveal: { enabled: true, duration: 450, stagger: 60 },
  interaction: { cardHover: 'lift', linkHover: 'underline' },
}

/** 每个预设均为可直接保存的完整模板。 */
export const MOTION_PRESETS: Record<MotionConfig['preset'], MotionConfig> = {
  static: {
    version: 2,
    preset: 'static',
    intensity: 'off',
    respectReducedMotion: true,
    mobileIntensity: 'off',
    autoDegrade: true,
    decoration: { type: 'none', opacity: 0 },
    reveal: { enabled: false, duration: 450, stagger: 0 },
    interaction: { cardHover: 'none', linkHover: 'none' },
  },
  editorial: structuredClone(DEFAULT_MOTION),
  narrative: {
    ...structuredClone(DEFAULT_MOTION),
    preset: 'narrative',
    reveal: { enabled: true, duration: 550, stagger: 80 },
  },
  kinetic: {
    ...structuredClone(DEFAULT_MOTION),
    preset: 'kinetic',
    reveal: { enabled: true, duration: 650, stagger: 100 },
  },
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** 只提取旧合同中仍合法的字段，绝不传播旧背景或光标配置。 */
export function upgradeMotionV1(value: unknown): MotionConfig {
  const old = record(value)
  const next = structuredClone(MOTION_PRESETS[old.preset === 'minimal' ? 'static' : 'editorial'])
  if (typeof old.intensity === 'string' && ['off', 'subtle', 'standard'].includes(old.intensity))
    next.intensity = old.intensity as MotionConfig['intensity']
  if (old.mobileIntensity === 'off' || old.mobileIntensity === 'subtle')
    next.mobileIntensity = old.mobileIntensity
  if (typeof old.autoDegrade === 'boolean') next.autoDegrade = old.autoDegrade
  const reveal = record(old.reveal)
  if (typeof reveal.enabled === 'boolean') next.reveal.enabled = reveal.enabled
  const clamp = (number: unknown, min: number, max: number, fallback: number) =>
    typeof number === 'number' && Number.isFinite(number)
      ? Math.min(max, Math.max(min, Math.round(number)))
      : fallback
  next.reveal.duration = clamp(reveal.duration, 150, 800, next.reveal.duration)
  next.reveal.stagger = clamp(reveal.stagger, 0, 100, next.reveal.stagger)
  next.decoration = { type: 'none', opacity: 0 }
  next.respectReducedMotion = true
  return motionSchema.parse(next)
}

/** 公开渲染面对损坏配置安全回退；旧值由服务层完成备份与持久化升级。 */
export function readMotionConfig(value: unknown): MotionConfig {
  if (record(value).version === 1) return upgradeMotionV1(value)
  const parsed = motionSchema.safeParse(value)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_MOTION)
}
