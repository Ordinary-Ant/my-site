import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
const text = (max = 500) => z.string().max(max)
const nullable = text().nullable()
const link = z
  .string()
  .max(2000)
  .refine(
    (v) => v === '' || (!!safeContentUrl(v) && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(v)),
    '链接格式无效',
  )
  .nullable()
export const settingGroups = {
  general: z
    .object({
      'site.name': text(40).min(1),
      'site.description': text(200),
      'site.logo': link,
      'site.locale': text(20),
      'site.favicon': link,
    })
    .strict()
    .partial(),
  theme: z
    .object({
      'theme.default': z.enum(['system', 'light', 'dark']),
      'theme.accent': z.string().regex(/^#[a-f0-9]{6}$/i),
    })
    .strict()
    .partial(),
  seo: z
    .object({
      'seo.defaultTitle': text(60),
      'seo.defaultDescription': text(200),
      'seo.keywords': text(500),
      'seo.ogImage': link,
    })
    .strict()
    .partial(),
  footer: z
    .object({
      'footer.copyright': text(200),
      'footer.icp': nullable,
      'footer.links': z.array(z.object({ label: text(80), url: link }).strict()).max(20),
    })
    .strict()
    .partial(),
  social: z
    .object({
      'social.github': link,
      'social.email': z.string().email().or(z.literal('')).nullable(),
      'social.phone': text(40).nullable(),
      'social.twitter': link,
      'social.linkedin': link,
      'social.weibo': link,
      'social.bilibili': link,
    })
    .strict()
    .partial(),
  integration: z
    .object({ 'integration.analyticsId': text(100) })
    .strict()
    .partial(),
  motion: z
    .object({ 'motion.config': z.record(z.unknown()) })
    .strict()
    .partial(),
} as const
export type SettingGroup = keyof typeof settingGroups
