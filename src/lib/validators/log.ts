import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
export const logTypes = ['DAILY', 'EVENT', 'SUMMARY'] as const
export const logDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`)
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day &&
      Number(day.slice(0, 4)) >= 1 &&
      Number(day.slice(0, 4)) <= 9998
    )
  }, '日期必须是有效YYYY-MM-DD')
const media = z
  .string()
  .max(2000)
  .refine((value) => !!safeContentUrl(value), '媒体地址不安全')
export const LogCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().min(1).max(1_000_000),
    summary: z.string().max(500).nullable().optional(),
    type: z.enum(logTypes).default('DAILY'),
    logDate: logDateSchema,
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('PUBLISHED'),
    publishedAt: z.coerce.date().nullable().optional(),
    mood: z.enum(['happy', 'excited', 'calm', 'tired', 'down', 'angry']).nullable().optional(),
    weather: z.enum(['sunny', 'cloudy', 'overcast', 'rain', 'snow', 'fog']).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    coverImage: media.nullable().optional(),
    images: z.array(media).max(100).default([]),
    isPinned: z.boolean().default(false),
    tagIds: z.array(z.string().cuid()).max(10).default([]),
  })
  .strict()
export const LogUpdateSchema = LogCreateSchema.partial()
  .extend({ revision: z.number().int().min(1) })
  .strict()
export const LogRevisionSchema = z.object({ revision: z.number().int().min(1) }).strict()
export const LogBulkSchema = z
  .object({
    ids: z.array(z.string().cuid()).min(1).max(100),
    revisions: z.record(z.string(), z.number().int().min(1)),
    action: z.enum([
      'publish',
      'unpublish',
      'archive',
      'delete',
      'restore',
      'addTags',
      'removeTags',
    ]),
    payload: z
      .object({ tagIds: z.array(z.string().cuid()).max(10) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    for (const id of body.ids)
      if (!body.revisions[id])
        ctx.addIssue({ code: 'custom', path: ['revisions', id], message: '需要revision' })
    if (['addTags', 'removeTags'].includes(body.action) && !body.payload)
      ctx.addIssue({ code: 'custom', path: ['payload'], message: '需要tagIds' })
  })
