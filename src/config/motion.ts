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
