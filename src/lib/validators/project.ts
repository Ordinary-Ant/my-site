import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
import { slugSchema } from './article'

export const projectTypes = ['GAME', 'REPO', 'SKILL', 'OTHER'] as const
const url = z
  .string()
  .max(2000)
  .refine((value) => !!safeContentUrl(value), '地址不安全')
// JSON日期先核验实际日历，再转换；避免Date把不存在的日期滚动到下月。
export const projectDateSchema = z
  .string()
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false
    const day = value.slice(0, 10),
      date = new Date(`${day}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return false
    if (value.length > 10 && !z.string().datetime({ offset: true }).safeParse(value).success)
      return false
    return Number.isFinite(new Date(value).getTime())
  }, '日期必须为有效ISO日期')
  .transform((value) => new Date(value))
const fields = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: slugSchema,
    subtitle: z.string().max(500).nullable().optional(),
    description: z.string().trim().min(1).max(5000),
    content: z.string().max(1_000_000).nullable().optional(),
    coverImage: url.nullable().optional(),
    gallery: z.array(url).max(100).default([]),
    type: z.enum(projectTypes).default('REPO'),
    techStack: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    role: z.string().max(200).nullable().optional(),
    highlights: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    links: z
      .object({
        github: url.nullable().optional(),
        demo: url.nullable().optional(),
        video: url.nullable().optional(),
        docs: url.nullable().optional(),
        article: url.nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    startDate: projectDateSchema.nullable().optional(),
    endDate: projectDateSchema.nullable().optional(),
    publishedAt: projectDateSchema.nullable().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('PUBLISHED'),
    featured: z.boolean().default(false),
    order: z.number().int().min(0).max(1_000_000).default(0),
    tagIds: z.array(z.string().cuid()).max(10).default([]),
  })
  .strict()
const dates = (body: { startDate?: Date | null; endDate?: Date | null }, ctx: z.RefinementCtx) => {
  if (body.startDate && body.endDate && body.endDate < body.startDate)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' })
}
export const ProjectCreateSchema = fields.superRefine(dates)
export const ProjectUpdateSchema = fields
  .partial()
  .extend({ revision: z.number().int().min(1) })
  .strict()
  .superRefine(dates)
export const ProjectRevisionSchema = z.object({ revision: z.number().int().min(1) }).strict()
export const ProjectReorderSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().cuid(),
            order: z.number().int().min(0).max(1_000_000),
            revision: z.number().int().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (body) => new Set(body.items.map((item) => item.id)).size === body.items.length,
    '排序标识不能重复',
  )
export const ProjectBulkSchema = z
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
