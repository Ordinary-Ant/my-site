import 'server-only'
import { randomBytes, createHash } from 'node:crypto'
import { Prisma, type Log } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import {
  LogCreateSchema,
  LogUpdateSchema,
  LogRevisionSchema,
  LogBulkSchema,
  logDateSchema,
  logTypes,
} from '@/lib/validators/log'
import { requirePermission } from './auth'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'
import { invalidateContent } from './cache'
import { applyPublicPrivacy } from './public-site'
const include = {
  tags: true,
  author: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.LogInclude
const missing = () => new ApiError(404, 'NOT_FOUND', '日志不存在')
const conflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', '内容已被其他窗口修改，请先比较最新版本')
export const todayLogDate = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`)
const dto = <T extends Log>(item: T) => ({
  ...item,
  logDate: item.logDate.toISOString().slice(0, 10),
})
const integer = (value: string | null, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.floor(Number(value)) || fallback))
/** 同一公开过滤用于列表、详情和日历，置顶只放宽日志日期。 */
export function publicLogWhere(types: readonly string[] = logTypes): Prisma.LogWhereInput {
  return {
    status: 'PUBLISHED',
    deletedAt: null,
    publishedAt: { lte: new Date() },
    type: { in: logTypes.filter((x) => types.includes(x)) },
    OR: [{ logDate: { lte: dayDate(todayLogDate()) } }, { isPinned: true }],
  }
}
async function publicWhere() {
  const logModule = await prisma.module.findUnique({ where: { key: 'log' } })
  const config = logModule?.config as { pageSize?: number; types?: Record<string, boolean> } | null
  return {
    module: logModule,
    config,
    where: publicLogWhere(logTypes.filter((type) => config?.types?.[type] !== false)),
  }
}
const publicFields = [
  'id',
  'title',
  'summary',
  'type',
  'logDate',
  'publishedAt',
  'revision',
  'mood',
  'weather',
  'location',
  'coverImage',
  'images',
  'status',
  'isPinned',
  'viewCount',
  'createdAt',
  'updatedAt',
  'tags',
  'author',
]
const adminFields = [...publicFields, 'content', 'authorId', 'deletedAt']
/** 稀疏字段只投影已完成隐私清理的DTO，不接受数据库选择器。 */
function requestedFields(params: URLSearchParams, admin = false) {
  if (!params.has('fields')) return null
  const fields = params.get('fields')!.split(',')
  if (
    !fields.length ||
    fields.some((field) => !(admin ? adminFields : publicFields).includes(field))
  )
    throw new ApiError(400, 'VALIDATION_ERROR', '字段参数无效')
  return [...new Set(fields)]
}
function projectFields<T extends object>(items: T[], fields: string[] | null): T[] {
  return fields
    ? items.map(
        (item) => Object.fromEntries(fields.map((field) => [field, item[field as keyof T]])) as T,
      )
    : items
}
function rangeDay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return logDateSchema.parse(value)
  z.string().datetime({ offset: true }).parse(value)
  logDateSchema.parse(value.slice(0, 10))
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) throw new ApiError(400, 'VALIDATION_ERROR', '日期或时区偏移无效')
  return logDateSchema.parse(new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10))
}
function filters(params: URLSearchParams, where: Prisma.LogWhereInput) {
  const clauses: Prisma.LogWhereInput[] = []
  const from = params.has('from') ? rangeDay(params.get('from')!) : null,
    to = params.has('to') ? rangeDay(params.get('to')!) : null
  if (from && to && from > to)
    throw new ApiError(400, 'VALIDATION_ERROR', '日期范围起点不能晚于终点')
  if (from || to)
    clauses.push({
      logDate: { ...(from ? { gte: dayDate(from) } : {}), ...(to ? { lte: dayDate(to) } : {}) },
    })
  const type = params.get('type')
  if (type)
    clauses.push({
      type: logTypes.includes(type as (typeof logTypes)[number])
        ? (type as (typeof logTypes)[number])
        : { in: [] },
    })
  const year = params.get('year'),
    month = params.get('month'),
    date = params.get('date')
  if (year || month) {
    const y = integer(
        year,
        Number((date ? logDateSchema.parse(date) : todayLogDate()).slice(0, 4)),
        1,
        9998,
      ),
      m = month ? integer(month, 1, 1, 12) : 1
    clauses.push({
      logDate: {
        gte: dayDate(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`),
        lt: dayDate(
          month
            ? m === 12
              ? `${String(y + 1).padStart(4, '0')}-01-01`
              : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-01`
            : `${String(y + 1).padStart(4, '0')}-01-01`,
        ),
      },
    })
  }
  if (date) clauses.push({ logDate: dayDate(logDateSchema.parse(date)) })
  if (params.get('mood')) clauses.push({ mood: params.get('mood')! })
  const q = params.get('q')?.slice(0, 200)
  if (q)
    clauses.push({
      OR: ['title', 'summary', 'content'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      })),
    })
  for (const slug of params.get('tag')?.split(',').filter(Boolean) ?? [])
    clauses.push({ tags: { some: { slug } } })
  return { ...where, AND: clauses }
}
/** 只允许固定字段；兼容通用负号语法与后台显式方向。 */
function adminSort(value: string): Prisma.LogOrderByWithRelationInput[] {
  const fields = value.split(',')
  if (fields.length > 4 || !value) throw new ApiError(400, 'VALIDATION_ERROR', '排序参数无效')
  const result: Prisma.LogOrderByWithRelationInput[] = []
  for (const field of fields) {
    const match = /^(logDate|updatedAt|title|viewCount):(asc|desc)$/.exec(field)
    const plain = /^(-?)(logDate|updatedAt|title|viewCount)$/.exec(field)
    if (!match && !plain) throw new ApiError(400, 'VALIDATION_ERROR', '排序字段或方向无效')
    const key = match ? match[1] : plain![2],
      direction = match ? match[2] : plain![1] ? 'desc' : 'asc'
    result.push({ [key]: direction })
  }
  return [...result, { id: 'asc' }]
}
const meta = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
  hasNext: page * pageSize < total,
  hasPrev: page > 1,
})
async function list(
  where: Prisma.LogWhereInput,
  params: URLSearchParams,
  defaultSize = 10,
  admin = false,
) {
  const page = integer(params.get('page'), 1, 1, 100000),
    pageSize = integer(params.get('pageSize'), defaultSize, 1, 100)
  const [items, total] = await prisma.$transaction([
    prisma.log.findMany({
      where,
      include,
      orderBy:
        admin && params.has('sort')
          ? adminSort(params.get('sort')!)
          : [{ isPinned: 'desc' }, { logDate: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.log.count({ where }),
  ])
  return { data: items.map(dto), meta: meta(page, pageSize, total) }
}
export async function listPublicLogs(params = new URLSearchParams()) {
  const fields = requestedFields(params)
  const { module, config, where } = await publicWhere()
  if (!module?.enabled) {
    const page = integer(params.get('page'), 1, 1, 100000),
      size = integer(params.get('pageSize'), config?.pageSize ?? 10, 1, 100)
    return { data: [], meta: meta(page, size, 0) }
  }
  const result = await list(filters(params, where), params, config?.pageSize ?? 10)
  const safeItems = await applyPublicPrivacy(
    result.data.map(({ content, deletedAt: _deleted, authorId: _author, ...item }) => ({
      ...item,
      summary: item.summary ?? content.replace(/[#*_`>]/g, ''),
    })),
  )
  return {
    ...result,
    data: projectFields(
      safeItems.map((item) => ({ ...item, summary: [...item.summary].slice(0, 120).join('') })),
      fields,
    ),
  }
}
export async function getPublicLog(id: string) {
  const { module, where } = await publicWhere()
  if (!module?.enabled) throw missing()
  const item = await prisma.log.findFirst({ where: { ...where, id }, include })
  if (!item) throw missing()
  const adjacency = async (previous: boolean) =>
    prisma.log.findFirst({
      where: {
        ...where,
        AND: [
          {
            OR: [
              { logDate: previous ? { gt: item.logDate } : { lt: item.logDate } },
              { logDate: item.logDate, id: previous ? { lt: id } : { gt: id } },
            ],
          },
        ],
      },
      select: { id: true, title: true, logDate: true },
      orderBy: [{ logDate: previous ? 'asc' : 'desc' }, { id: previous ? 'desc' : 'asc' }],
    })
  const [prev, next] = await Promise.all([adjacency(true), adjacency(false)])
  const { deletedAt: _deleted, authorId: _author, ...value } = dto(item)
  return applyPublicPrivacy({
    ...value,
    prev: prev ? { ...prev, logDate: prev.logDate.toISOString().slice(0, 10) } : null,
    next: next ? { ...next, logDate: next.logDate.toISOString().slice(0, 10) } : null,
  })
}
async function calendar(params: URLSearchParams, where: Prisma.LogWhereInput, enabled = true) {
  const year = integer(
      params.get('year'),
      Number(
        (params.get('date') ? logDateSchema.parse(params.get('date')) : todayLogDate()).slice(0, 4),
      ),
      1,
      9998,
    ),
    query = new URLSearchParams(params)
  query.set('year', String(year))
  const rows = enabled
    ? await prisma.log.groupBy({
        by: ['logDate'],
        where: filters(query, where),
        _count: true,
        orderBy: { logDate: 'asc' },
      })
    : []
  const months = new Map<
    number,
    { month: number; count: number; days: number[]; dayCounts: Record<string, number> }
  >()
  for (const row of rows) {
    const day = row.logDate.toISOString().slice(0, 10),
      m = Number(day.slice(5, 7)),
      d = Number(day.slice(8, 10))
    const bucket = months.get(m) ?? { month: m, count: 0, days: [], dayCounts: {} }
    bucket.count += row._count
    bucket.days.push(d)
    bucket.dayCounts[String(d)] = row._count
    months.set(m, bucket)
  }
  return {
    year,
    months: [...months.values()],
    total: rows.reduce((sum, row) => sum + row._count, 0),
  }
}
export async function getLogCalendar(params = new URLSearchParams()) {
  const { module, where } = await publicWhere()
  return calendar(params, where, !!module?.enabled)
}
function adminWhere(params: URLSearchParams): Prisma.LogWhereInput {
  const status = params.has('status') ? params.get('status')!.split(',') : []
  if (status.some((value) => !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(value)))
    throw new ApiError(400, 'VALIDATION_ERROR', '状态参数无效')
  return {
    deletedAt: params.get('includeDeleted') === 'true' ? { not: null } : null,
    ...(status.length ? { status: { in: status as ('DRAFT' | 'PUBLISHED' | 'ARCHIVED')[] } } : {}),
  }
}
export async function listAdminLogs(params = new URLSearchParams(), request?: Request) {
  await requirePermission('content:read', request)
  const fields = requestedFields(params, true)
  const result = await list(filters(params, adminWhere(params)), params, 20, true)
  return { ...result, data: projectFields(result.data, fields) }
}
export async function listAdminLogCalendar(params = new URLSearchParams(), request?: Request) {
  await requirePermission('content:read', request)
  return calendar(params, adminWhere(params))
}
export async function getAdminLog(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const item = await prisma.log.findUnique({ where: { id }, include })
  if (!item) throw missing()
  return dto(item)
}
export async function createLog(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = LogCreateSchema.parse(input)
  if (body.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
    throw new ApiError(403, 'FORBIDDEN', '不能发布日志')
  const { tagIds, ...data } = body
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.log.create({
      data: {
        ...data,
        logDate: dayDate(data.logDate),
        authorId: user.id,
        publishedAt:
          data.status === 'PUBLISHED' ? (data.publishedAt ?? new Date()) : data.publishedAt,
        tags: { connect: [...new Set(tagIds)].map((id) => ({ id })) },
      },
      include,
    })
    await writeAudit(tx, {
      userId: user.id,
      action: 'create',
      resource: 'log',
      resourceId: created.id,
      after: { title: created.title, status: created.status, revision: created.revision },
    })
    return created
  })
  invalidateContent('log')
  return dto(item)
}
/** 内容、标签、revision和审计共用事务，避免关系失败留下半次更新。 */
async function writeLog(id: string, input: unknown, request?: Request, auditAction?: string) {
  const user = await requirePermission('content:write', request),
    { revision, tagIds, ...data } = LogUpdateSchema.parse(input)
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.log.findUnique({ where: { id }, include: { tags: true } })
    if (!before || before.deletedAt) throw missing()
    if (before.revision !== revision) throw conflict()
    if (
      (data.status === 'PUBLISHED' || before.status === 'PUBLISHED') &&
      !user.permissions.includes('content:publish')
    )
      throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
    const status = data.status ?? before.status,
      publishedAt = data.publishedAt === undefined ? before.publishedAt : data.publishedAt
    const result = await tx.log.updateMany({
      where: { id, revision, deletedAt: null },
      data: {
        ...data,
        ...(data.logDate ? { logDate: dayDate(data.logDate) } : {}),
        publishedAt: status === 'PUBLISHED' ? (publishedAt ?? new Date()) : publishedAt,
        revision: { increment: 1 },
      },
    })
    if (!result.count) throw conflict()
    const updated = await tx.log.update({
      where: { id },
      data:
        tagIds === undefined ? {} : { tags: { set: [...new Set(tagIds)].map((id) => ({ id })) } },
      include,
    })
    await writeAudit(tx, {
      userId: user.id,
      action:
        auditAction ??
        (data.status === 'PUBLISHED'
          ? 'publish'
          : data.status === 'DRAFT'
            ? 'unpublish'
            : data.status === 'ARCHIVED'
              ? 'archive'
              : 'update'),
      resource: 'log',
      resourceId: id,
      before: Object.fromEntries(
        [...new Set([...Object.keys(data), 'revision', 'status', 'publishedAt'])]
          .map((key) => [key, before[key as keyof typeof before]])
          .concat(tagIds === undefined ? [] : [['tagIds', before.tags.map((tag) => tag.id)]]),
      ),
      after: Object.fromEntries(
        [...new Set([...Object.keys(data), 'revision', 'status', 'publishedAt'])]
          .map((key) => [key, updated[key as keyof typeof updated]])
          .concat(tagIds === undefined ? [] : [['tagIds', updated.tags.map((tag) => tag.id)]]),
      ),
    })
    return updated
  })
  invalidateContent('log')
  return dto(item)
}
export const updateLog = (id: string, input: unknown, request?: Request) =>
  writeLog(id, input, request)
async function changeDeleted(id: string, revision: number, restore: boolean, request?: Request) {
  const user = await requirePermission('content:write', request)
  LogRevisionSchema.parse({ revision })
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.log.findUnique({ where: { id }, include: { tags: true } })
    if (!before) throw missing()
    if (before.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
      throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
    const result = await tx.log.updateMany({
      where: { id, revision, deletedAt: restore ? { not: null } : null },
      data: { deletedAt: restore ? null : new Date(), revision: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    await writeAudit(tx, {
      userId: user.id,
      action: restore ? 'restore' : 'delete',
      resource: 'log',
      resourceId: id,
      before: { deletedAt: before.deletedAt },
      after: { deletedAt: restore ? null : 'deleted' },
    })
    return tx.log.findUniqueOrThrow({ where: { id }, include })
  })
  invalidateContent('log')
  return dto(item)
}
export const deleteLog = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, false, request)
export const restoreLog = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, true, request)
export async function purgeLog(id: string, revision: number, request?: Request) {
  const user = await requirePermission('content:write', request)
  if (user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '只有管理员可以彻底删除')
  LogRevisionSchema.parse({ revision })
  await prisma.$transaction(async (tx) => {
    const result = await tx.log.deleteMany({ where: { id, revision, deletedAt: { not: null } } })
    if (!result.count) throw conflict()
    await tx.previewToken.deleteMany({ where: { kind: 'log', contentId: id } })
    await writeAudit(tx, { userId: user.id, action: 'purge', resource: 'log', resourceId: id })
  })
  invalidateContent('log')
}
export async function bulkLogs(input: unknown, request?: Request) {
  await requirePermission('content:write', request)
  const body = LogBulkSchema.parse(input),
    succeeded: string[] = [],
    failed: { id: string; code: string; message: string }[] = []
  for (const id of [...new Set(body.ids)]) {
    try {
      const revision = body.revisions[id]
      if (body.action === 'delete') await deleteLog(id, revision, request)
      else if (body.action === 'restore') await restoreLog(id, revision, request)
      else if (body.action === 'addTags' || body.action === 'removeTags') {
        const existing = await getAdminLog(id, request),
          requested = body.payload!.tagIds,
          tagIds =
            body.action === 'addTags'
              ? [...new Set([...existing.tags.map((x) => x.id), ...requested])]
              : existing.tags.map((x) => x.id).filter((x) => !requested.includes(x))
        await writeLog(id, { revision, tagIds }, request, body.action)
      } else
        await updateLog(
          id,
          {
            revision,
            status:
              body.action === 'publish'
                ? 'PUBLISHED'
                : body.action === 'unpublish'
                  ? 'DRAFT'
                  : 'ARCHIVED',
          },
          request,
        )
      succeeded.push(id)
    } catch (error) {
      if (error instanceof ApiError) failed.push({ id, code: error.code, message: error.message })
      else if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2025', 'P2018'].includes(error.code)
      )
        failed.push({ id, code: 'NOT_FOUND', message: '日志或标签不存在' })
      else if (error instanceof z.ZodError)
        failed.push({ id, code: 'VALIDATION_ERROR', message: '输入格式不正确' })
      else throw error
    }
  }
  return { succeeded, failed }
}

async function requireLogModule() {
  const logModule = await prisma.module.findUnique({ where: { key: 'log' } })
  if (!logModule?.enabled) throw missing()
}
/** 预览授权独立于公开类型开关，模块关闭及软删除仍不可绕过。 */
export async function createLogPreviewToken(id: string, request?: Request) {
  const user = await requirePermission('content:read', request)
  // 凭据创建属于后台写入，即使只读角色可预览也共享写入额度。
  await consumeRateLimit('adminwrite:' + user.id, 120, 900000)
  await requireLogModule()
  const item = await prisma.log.findFirst({ where: { id, deletedAt: null } })
  if (!item) throw missing()
  const token = randomBytes(32).toString('base64url'),
    expiresAt = new Date(Date.now() + 86400000)
  await prisma.previewToken.create({
    data: {
      hash: createHash('sha256').update(token).digest('hex'),
      kind: 'log',
      contentId: id,
      expiresAt,
    },
  })
  return { token, url: `/preview/${token}`, expiresAt }
}
export async function getPreviewLog(token: string) {
  await requireLogModule()
  const preview = await prisma.previewToken.findUnique({
    where: { hash: createHash('sha256').update(token).digest('hex') },
  })
  if (!preview || preview.kind !== 'log' || preview.expiresAt <= new Date()) throw missing()
  const item = await prisma.log.findFirst({
    where: { id: preview.contentId, deletedAt: null },
    include,
  })
  if (!item) throw missing()
  return dto(item)
}
