import 'server-only'
import type { Prisma, TimelineItem } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import {
  TimelineCreateSchema,
  TimelineUpdateSchema,
  TimelineRevisionSchema,
  TimelineReorderSchema,
  timelineTypes,
  timelineDateSchema,
  normalizeTimelineDate,
} from '@/lib/validators/timeline'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateContent } from './cache'
import { revalidateTag } from 'next/cache'
import { applyPublicPrivacy } from './public-site'
const missing = () => new ApiError(404, 'NOT_FOUND', '经历不存在')
const conflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', '内容已被其他窗口修改，请先比较最新版本')
const invalid = (message: string) => new ApiError(400, 'VALIDATION_ERROR', message)
const publicFields = [
  'id',
  'title',
  'subtitle',
  'description',
  'type',
  'organization',
  'location',
  'startDate',
  'endDate',
  'isCurrent',
  'startPrecision',
  'endPrecision',
  'logo',
  'tags',
  'highlights',
  'order',
  'visible',
  'showOnAbout',
  'revision',
  'createdAt',
  'updatedAt',
]
function validateQuery(params: URLSearchParams, admin = false) {
  const allowed = admin
    ? ['type', 'q', 'page', 'pageSize', 'includeDeleted', 'deleted']
    : ['type', 'from', 'to', 'q', 'fields']
  for (const key of params.keys()) if (!allowed.includes(key)) throw invalid('查询参数无效')
  if (
    params.has('type') &&
    !timelineTypes.includes(params.get('type') as (typeof timelineTypes)[number])
  )
    throw invalid('类型参数无效')
  if (params.has('q') && params.get('q')!.length > 200) throw invalid('搜索词过长')
  for (const key of ['includeDeleted', 'deleted'])
    if (params.has(key) && !['true', 'false'].includes(params.get(key)!))
      throw invalid('删除参数无效')
  for (const key of ['page', 'pageSize'])
    if (
      params.has(key) &&
      (!/^\d+$/.test(params.get(key)!) ||
        Number(params.get(key)) < 1 ||
        Number(params.get(key)) > (key === 'pageSize' ? 100 : 100000))
    )
      throw invalid('分页参数无效')
  const fields = params.has('fields') ? params.get('fields')!.split(',') : null
  if (fields?.some((field) => !publicFields.includes(field))) throw invalid('字段参数无效')
  return fields
}
function filters(params: URLSearchParams): Prisma.TimelineItemWhereInput {
  const range = (key: string, end = false) => {
    if (!params.has(key)) return null
    const parsed = timelineDateSchema.safeParse(params.get(key))
    if (!parsed.success) throw invalid('日期参数无效')
    const value = parsed.data
    const date = normalizeTimelineDate(
      value,
      value.length === 4 ? 'YEAR' : value.length === 7 ? 'MONTH' : 'DAY',
    )
    if (end) {
      if (value.length === 4) date.setUTCFullYear(date.getUTCFullYear() + 1)
      else if (value.length === 7) date.setUTCMonth(date.getUTCMonth() + 1)
      else date.setUTCDate(date.getUTCDate() + 1)
      date.setTime(date.getTime() - 1)
    }
    return date
  }
  const from = range('from'),
    to = range('to', true)
  if (from && to && from > to) throw invalid('日期范围起点不能晚于终点')
  const q = params.get('q')
  return {
    ...(params.has('type') ? { type: params.get('type') as (typeof timelineTypes)[number] } : {}),
    ...(from || to
      ? { startDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(q
      ? {
          OR: ['title', 'subtitle', 'description', 'organization', 'location'].map((field) => ({
            [field]: { contains: q, mode: 'insensitive' },
          })),
        }
      : {}),
  }
}
async function timelineModule() {
  const timeline = await prisma.module.findUnique({ where: { key: 'timeline' } })
  const config = timeline?.config as {
    direction?: 'asc' | 'desc'
    types?: Record<string, boolean>
  } | null
  return { module: timeline, config }
}
function sorting(
  direction: 'asc' | 'desc' = 'desc',
): Prisma.TimelineItemOrderByWithRelationInput[] {
  return [{ isCurrent: 'desc' }, { startDate: direction }, { order: 'asc' }, { id: 'asc' }]
}
const dto = ({ deletedAt: _deleted, ...item }: TimelineItem) => item
export async function listPublicTimeline(params = new URLSearchParams()) {
  const fields = validateQuery(params),
    filter = filters(params),
    { module, config } = await timelineModule()
  if (!module?.enabled) return { data: [], meta: { total: 0 } }
  const data = await prisma.timelineItem.findMany({
    where: {
      visible: true,
      deletedAt: null,
      type: { in: timelineTypes.filter((type) => config?.types?.[type] !== false) },
      AND: [filter],
    },
    orderBy: sorting(config?.direction),
  })
  const safe = await applyPublicPrivacy(data.map(dto))
  return {
    data: fields
      ? safe.map(
          (item) =>
            Object.fromEntries(
              fields.map((field) => [field, item[field as keyof typeof item]]),
            ) as typeof item,
        )
      : safe,
    meta: { total: data.length },
  }
}
export async function getPublicAboutExperience() {
  const [{ module, config }, about] = await Promise.all([
    timelineModule(),
    prisma.module.findUnique({ where: { key: 'about' } }),
  ])
  const aboutConfig = about?.config as { sections?: { experience?: boolean } } | null
  if (
    !module?.enabled ||
    config?.types?.WORK === false ||
    !about?.enabled ||
    aboutConfig?.sections?.experience === false
  )
    return []
  return applyPublicPrivacy(
    (
      await prisma.timelineItem.findMany({
        where: { type: 'WORK', showOnAbout: true, deletedAt: null },
        orderBy: sorting(config?.direction),
      })
    ).map(dto),
  )
}
export async function listAdminTimeline(params = new URLSearchParams(), request?: Request) {
  await requirePermission('content:read', request)
  validateQuery(params, true)
  const page = Number(params.get('page') ?? 1),
    pageSize = Number(params.get('pageSize') ?? 20)
  const where: Prisma.TimelineItemWhereInput = {
    ...filters(params),
    ...(params.get('deleted') === 'true'
      ? { deletedAt: { not: null } }
      : params.get('includeDeleted') === 'true'
        ? {}
        : { deletedAt: null }),
  }
  const { config } = await timelineModule()
  const [data, total] = await prisma.$transaction([
    prisma.timelineItem.findMany({
      where,
      orderBy: sorting(config?.direction),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.timelineItem.count({ where }),
  ])
  return {
    data,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
      hasPrev: page > 1,
    },
  }
}
export async function getAdminTimeline(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const item = await prisma.timelineItem.findUnique({ where: { id } })
  if (!item) throw missing()
  return item
}
function invalidate() {
  invalidateContent('timeline')
  revalidateTag('profile')
  revalidateTag('about')
}
async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  before: TimelineItem,
  after?: TimelineItem,
) {
  const keys = Object.keys(before).filter(
    (key) =>
      key !== 'updatedAt' &&
      (!after ||
        JSON.stringify(before[key as keyof TimelineItem]) !==
          JSON.stringify(after[key as keyof TimelineItem])),
  )
  await writeAudit(tx, {
    userId,
    action,
    resource: 'timeline',
    resourceId: before.id,
    before: Object.fromEntries(keys.map((key) => [key, before[key as keyof TimelineItem]])),
    ...(after
      ? { after: Object.fromEntries(keys.map((key) => [key, after[key as keyof TimelineItem]])) }
      : {}),
  })
}
export async function createTimeline(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    data = TimelineCreateSchema.parse(input)
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.timelineItem.create({ data })
    await writeAudit(tx, {
      userId: user.id,
      action: 'create',
      resource: 'timeline',
      resourceId: created.id,
      after: created,
    })
    return created
  })
  invalidate()
  return item
}
export async function updateTimeline(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { revision, ...patch } = TimelineUpdateSchema.parse(input)
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.timelineItem.findUnique({ where: { id } })
    if (!before || before.deletedAt) throw missing()
    if (before.revision !== revision) throw conflict()
    const {
      id: _id,
      revision: _revision,
      createdAt: _created,
      updatedAt: _updated,
      deletedAt: _deleted,
      ...fields
    } = before
    // 合并后再次校验完整日期合同；只改精度时也归一已有日期。
    const merged = TimelineCreateSchema.parse({
      ...fields,
      startDate: before.startDate.toISOString(),
      endDate: before.endDate?.toISOString() ?? null,
      ...patch,
      ...(patch.startDate ? { startDate: patch.startDate.toISOString() } : {}),
      ...(patch.endDate ? { endDate: patch.endDate.toISOString() } : {}),
    })
    const result = await tx.timelineItem.updateMany({
      where: { id, revision, deletedAt: null },
      data: { ...merged, revision: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    const after = await tx.timelineItem.findUniqueOrThrow({ where: { id } })
    await audit(tx, user.id, 'update', before, after)
    return after
  })
  invalidate()
  return item
}
async function deleted(id: string, revision: number, restore: boolean, request?: Request) {
  const user = await requirePermission('content:write', request)
  TimelineRevisionSchema.parse({ revision })
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.timelineItem.findUnique({ where: { id } })
    if (!before) throw missing()
    const result = await tx.timelineItem.updateMany({
      where: { id, revision, deletedAt: restore ? { not: null } : null },
      data: { deletedAt: restore ? null : new Date(), revision: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    const after = await tx.timelineItem.findUniqueOrThrow({ where: { id } })
    await audit(tx, user.id, restore ? 'restore' : 'delete', before, after)
    return after
  })
  invalidate()
  return item
}
export const deleteTimeline = (id: string, revision: number, request?: Request) =>
  deleted(id, revision, false, request)
export const restoreTimeline = (id: string, revision: number, request?: Request) =>
  deleted(id, revision, true, request)
export async function purgeTimeline(id: string, revision: number, request?: Request) {
  const user = await requirePermission('content:write', request)
  if (user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '只有管理员可以彻底删除')
  TimelineRevisionSchema.parse({ revision })
  await prisma.$transaction(async (tx) => {
    const before = await tx.timelineItem.findUnique({ where: { id } })
    if (!before) throw missing()
    const result = await tx.timelineItem.deleteMany({
      where: { id, revision, deletedAt: { not: null } },
    })
    if (!result.count) throw conflict()
    await audit(tx, user.id, 'purge', before)
  })
  invalidate()
}
export async function reorderTimeline(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = TimelineReorderSchema.parse(input)
  const items = await prisma.$transaction(async (tx) => {
    const updated: TimelineItem[] = []
    // 按id统一锁顺序，反向拖动不会互锁；order仅在同日期和current分组生效。
    for (const item of [...body.items].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM timeline_items WHERE id = ${item.id} FOR UPDATE`
      const before = await tx.timelineItem.findUnique({ where: { id: item.id } })
      if (!before || before.deletedAt) throw missing()
      const result = await tx.timelineItem.updateMany({
        where: { id: item.id, revision: item.revision, deletedAt: null },
        data: { order: item.order, revision: { increment: 1 } },
      })
      if (!result.count) throw conflict()
      const after = await tx.timelineItem.findUniqueOrThrow({ where: { id: item.id } })
      await audit(tx, user.id, 'reorder', before, after)
      updated.push(after)
    }
    return body.items.map((item) => updated.find((row) => row.id === item.id)!)
  })
  invalidate()
  return { items }
}
