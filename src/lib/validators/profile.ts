import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'

const text = (max = 200) => z.string().max(max)
const url = text(2000).refine((value) => !!safeContentUrl(value), '地址不安全')
const socialUrl = text(2000).refine(
  (value) =>
    !!safeContentUrl(value) ||
    (value.startsWith('mailto:') &&
      !/[%?&#\s]/.test(value) &&
      z.string().email().safeParse(value.slice(7)).success) ||
    /^tel:\+?[0-9][0-9().-]{2,30}$/.test(value),
  '社交地址不安全',
)
export const profileBirthdaySchema = z.string().refine((value) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1 ||
    Number(value.slice(0, 4)) > 9998
  )
    return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, '生日必须为有效日期')
const card = z
  .object({ title: text().trim().min(1), description: text(5000), icon: text(100) })
  .strict()
const fields = z
  .object({
    name: text().trim().min(1),
    headline: text(500).trim().min(1),
    bio: text(1_000_000),
    avatar: url.nullable().default(null),
    email: text(320).email().nullable().default(null),
    phone: text(100).nullable().default(null),
    location: text().nullable().default(null),
    birthday: profileBirthdaySchema.nullable().default(null),
    jobTitle: text().nullable().default(null),
    company: text().nullable().default(null),
    yearsOfExp: z.number().int().min(0).max(100).nullable().default(null),
    resumeUrl: url.nullable().default(null),
    contactVisible: z.boolean().default(true),
    socials: z
      .array(
        z
          .object({
            platform: text(100).trim().min(1),
            label: text().trim().min(1),
            url: socialUrl,
            icon: text(100),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    advantages: z.array(card).max(50).default([]),
    services: z.array(card).max(50).default([]),
    skills: z
      .array(
        z
          .object({
            category: text().trim().min(1),
            items: z
              .array(
                z
                  .object({
                    name: text().trim().min(1),
                    level: z.number().int().min(1).max(5),
                    years: z.number().min(0).max(100),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
export const ProfileSchema = fields
export const ProfileUpdateSchema = fields
  .partial()
  .extend({ revision: z.number().int().min(0) })
  .strict()
export type ProfileEditable = z.infer<typeof ProfileSchema>
