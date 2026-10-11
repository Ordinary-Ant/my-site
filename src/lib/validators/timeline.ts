import { z } from 'zod'
import { safeContentUrl } from '@/lib/markdown'
export const timelineTypes = ['WORK', 'EDUCATION', 'PROJECT', 'AWARD', 'MILESTONE'] as const
export const datePrecisions = ['YEAR', 'MONTH', 'DAY'] as const
export type TimelinePrecision = (typeof datePrecisions)[number]
export const timelineDateSchema = z.string().refine((value) => {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2}(?:T.*)?)?)?$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1 || year > 9998) return false
  const day =
    value.length === 4 ? value + '-01-01' : value.length === 7 ? value + '-01' : value.slice(0, 10)
  const parsed = new Date(day + 'T00:00:00Z')
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day &&
    (value.length <= 10 ||
      (z.string().datetime({ offset: true }).safeParse(value).success &&
        Number.isFinite(new Date(value).getTime())))
  )
}, '日期必须是0001–9998年的有效日历日期')
export function normalizeTimelineDate(value: string | Date, precision: TimelinePrecision): Date {
  const day =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.length === 4
        ? value + '-01-01'
        : value.length === 7
          ? value + '-01'
          : value.slice(0, 10)
  return new Date(
    (precision === 'YEAR'
      ? day.slice(0, 4) + '-01-01'
      : precision === 'MONTH'
        ? day.slice(0, 7) + '-01'
        : day) + 'T00:00:00Z',
  )
}
const precisionFor = (value: string): TimelinePrecision =>
  value.length === 4 ? 'YEAR' : value.length === 7 ? 'MONTH' : 'DAY'
const fields = z
  .object({
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().max(500).nullable().optional(),
    description: z.string().max(1_000_000).nullable().optional(),
    type: z.enum(timelineTypes),
    organization: z.string().max(500).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    startDate: timelineDateSchema,
    endDate: timelineDateSchema.nullable().optional(),
    isCurrent: z.boolean().default(false),
    startPrecision: z.enum(datePrecisions).optional(),
    endPrecision: z.enum(datePrecisions).optional(),
    logo: z
      .string()
      .max(2000)
      .refine((v) => !!safeContentUrl(v), '地址不安全')
      .nullable()
      .optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    highlights: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
    order: z.number().int().min(0).max(1_000_000).default(0),
    visible: z.boolean().default(true),
    showOnAbout: z.boolean().default(true),
  })
  .strict()
function normalize<
  T extends {
    startDate?: string
    endDate?: string | null
    startPrecision?: TimelinePrecision
    endPrecision?: TimelinePrecision
  },
>(
  body: T,
): Omit<T, 'startDate' | 'endDate'> & {
  startDate?: Date
  endDate?: Date | null
  startPrecision?: TimelinePrecision
  endPrecision?: TimelinePrecision
} {
  const { startDate, endDate, ...rest } = body
  return {
    ...rest,
    ...(startDate === undefined
      ? {}
      : {
          startDate: normalizeTimelineDate(
            startDate,
            body.startPrecision ?? precisionFor(startDate),
          ),
          startPrecision: body.startPrecision ?? precisionFor(startDate),
        }),
    ...(endDate === undefined
      ? {}
      : endDate === null
        ? { endDate: null }
        : {
            endDate: normalizeTimelineDate(endDate, body.endPrecision ?? precisionFor(endDate)),
            endPrecision: body.endPrecision ?? precisionFor(endDate),
          }),
  }
}
function dates(
  body: { startDate?: Date; endDate?: Date | null; isCurrent?: boolean },
  ctx: z.RefinementCtx,
) {
  if (body.startDate && body.endDate && body.endDate < body.startDate)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' })
  if (body.isCurrent && body.endDate)
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '当前经历结束日期必须为空' })
}
export const TimelineCreateSchema = fields
  .transform((body) => ({
    ...normalize(body),
    startDate: normalizeTimelineDate(
      body.startDate,
      body.startPrecision ?? precisionFor(body.startDate),
    ),
    startPrecision: body.startPrecision ?? precisionFor(body.startDate),
    endDate: body.endDate
      ? normalizeTimelineDate(body.endDate, body.endPrecision ?? precisionFor(body.endDate))
      : null,
    endPrecision: body.endPrecision ?? (body.endDate ? precisionFor(body.endDate) : 'MONTH'),
  }))
  .superRefine(dates)
export const TimelineUpdateSchema = fields
  .partial()
  .extend({ revision: z.number().int().min(1) })
  .strict()
  .transform(normalize)
  .superRefine(dates)
export const TimelineRevisionSchema = z.object({ revision: z.number().int().min(1) }).strict()
export const TimelineReorderSchema = z
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
