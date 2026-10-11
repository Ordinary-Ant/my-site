import 'server-only'
import { randomBytes, createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectRevisionSchema,
  ProjectBulkSchema,
  ProjectReorderSchema,
  projectDateSchema,
  projectTypes,
} from '@/lib/validators/project'
import { slugSchema } from '@/lib/validators/article'
import { requirePermission } from './auth'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'
import { invalidateContent } from './cache'
import { applyPublicPrivacy } from './public-site'

const include = { tags: true } satisfies Prisma.ProjectInclude
const missing = () => new ApiError(404, 'NOT_FOUND', '作品不存在')
const conflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', '内容已被其他窗口修改，请先比较最新版本')
const invalid = (message: string) => new ApiError(400, 'VALIDATION_ERROR', message)
const integer = (value: string | null, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.floor(Number(value)) || fallback))
export function publicProjectWhere(
  types: readonly string[] = projectTypes,
): Prisma.ProjectWhereInput {
  return {
    status: 'PUBLISHED',
    deletedAt: null,
    publishedAt: { lte: new Date() },
    type: { in: projectTypes.filter((type) => types.includes(type)) },
  }
}
async function publicWhere() {
  const projectModule = await prisma.module.findUnique({ where: { key: 'portfolio' } })
  const config = projectModule?.config as {
    pageSize?: number
    types?: Record<string, boolean>
  } | null
  return {
    module: projectModule,
    config,
    where: publicProjectWhere(projectTypes.filter((type) => config?.types?.[type] !== false)),
  }
}
const publicFields = [
  'id',
  'slug',
  'title',
  'subtitle',
  'description',
  'coverImage',
  'gallery',
  'type',
  'techStack',
  'role',
  'highlights',
  'links',
  'startDate',
  'endDate',
  'status',
  'featured',
  'publishedAt',
  'revision',
  'order',
  'viewCount',
  'createdAt',
  'updatedAt',
  'tags',
]
const adminFields = [...publicFields, 'content', 'deletedAt']
function requestedFields(params: URLSearchParams, admin = false) {
  if (!params.has('fields')) return null
  const fields = params.get('fields')!.split(',')
  if (
    !fields.length ||
    fields.some((field) => !(admin ? adminFields : publicFields).includes(field))
  )
    throw invalid('字段参数无效')
  return [...new Set(fields)]
}
function projectFields<T extends object>(items: T[], fields: string[] | null): T[] {
  return fields
    ? items.map(
        (item) => Object.fromEntries(fields.map((field) => [field, item[field as keyof T]])) as T,
      )
    : items
}
/** 纯日期按上海当日闭区间，ISO时区日期保持真实时刻。 */
function rangeDate(value: string, end = false) {
  const parsed = projectDateSchema.safeParse(value)
  if (!parsed.success) throw invalid('日期参数无效')
  return value.length === 10
    ? new Date(parsed.data.getTime() - 8 * 3600000 + (end ? 86400000 - 1 : 0))
    : parsed.data
}
function filters(params: URLSearchParams, where: Prisma.ProjectWhereInput) {
  const clauses: Prisma.ProjectWhereInput[] = []
  const from = params.has('from') ? rangeDate(params.get('from')!) : null,
    to = params.has('to') ? rangeDate(params.get('to')!, true) : null
  if (from && to && from > to) throw invalid('日期范围起点不能晚于终点')
  if (from || to)
    clauses.push({ startDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } })
  const type = params.get('type')
  if (type)
    clauses.push({
      type: projectTypes.includes(type as (typeof projectTypes)[number])
        ? (type as (typeof projectTypes)[number])
        : { in: [] },
    })
  if (params.has('featured')) {
    const value = params.get('featured')
    if (!['true', 'false'].includes(value!)) throw invalid('精选参数无效')
    clauses.push({ featured: value === 'true' })
  }
  const tech = params.get('tech')
  if (tech) clauses.push({ techStack: { has: tech } })
  const q = params.get('q')?.slice(0, 200)
  if (q)
    clauses.push({
      OR: ['title', 'subtitle', 'description', 'content'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      })),
    })
  for (const slug of params.get('tag')?.split(',').filter(Boolean) ?? [])
    clauses.push({ tags: { some: { slug } } })
  return { ...where, AND: clauses }
}
const defaultSort: Prisma.ProjectOrderByWithRelationInput[] = [
  { order: 'asc' },
  { startDate: { sort: 'desc', nulls: 'last' } },
  { id: 'asc' },
]
function sort(value: string | null): Prisma.ProjectOrderByWithRelationInput[] {
  if (value === null || value === '') return defaultSort
  if (value === 'latest')
    return [{ startDate: { sort: 'desc', nulls: 'last' } }, { order: 'asc' }, { id: 'asc' }]
  if (!value || value.split(',').length > 4) throw invalid('排序参数无效')
  const result: Prisma.ProjectOrderByWithRelationInput[] = []
  for (const field of value.split(',')) {
    const match = /^(order|startDate|updatedAt|title|viewCount):(asc|desc)$/.exec(field)
    const plain = /^(-?)(order|startDate|updatedAt|title|viewCount)$/.exec(field)
    if (!match && !plain) throw invalid('排序字段或方向无效')
    const key = match ? match[1] : plain![2],
      direction = (match ? match[2] : plain![1] ? 'desc' : 'asc') as 'asc' | 'desc'
    result.push(
      key === 'startDate'
        ? { startDate: { sort: direction, nulls: 'last' } }
        : { [key]: direction },
    )
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
async function list(where: Prisma.ProjectWhereInput, params: URLSearchParams, size: number) {
  const page = integer(params.get('page'), 1, 1, 100000),
    pageSize = integer(params.get('pageSize'), size, 1, 100)
  const orderBy = sort(params.get('sort'))
  const [data, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      include,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ])
  return { data, meta: meta(page, pageSize, total) }
}
export async function listPublicProjects(params = new URLSearchParams()) {
  const fields = requestedFields(params),
    { module, config, where } = await publicWhere()
  const filtered = filters(params, where),
    countsQuery = new URLSearchParams(params)
  countsQuery.delete('type')
  // Tab计数与列表共享公开条件，仅忽略当前类型，不把隐藏状态算入数字。
  const typeCounts: Record<(typeof projectTypes)[number], number> = {
    GAME: 0,
    REPO: 0,
    SKILL: 0,
    OTHER: 0,
  }
  const page = integer(params.get('page'), 1, 1, 100000),
    pageSize = integer(params.get('pageSize'), config?.pageSize ?? 12, 1, 100)
  sort(params.get('sort'))
  if (!module?.enabled) return { data: [], meta: { ...meta(page, pageSize, 0), typeCounts } }
  const [result, counts] = await Promise.all([
    list(filtered, params, config?.pageSize ?? 12),
    prisma.project.groupBy({ by: ['type'], where: filters(countsQuery, where), _count: true }),
  ])
  for (const row of counts) typeCounts[row.type] = row._count
  const safeItems = await applyPublicPrivacy(
    result.data.map(({ content: _content, deletedAt: _deleted, ...item }) => item),
  )
  return { data: projectFields(safeItems, fields), meta: { ...result.meta, typeCounts } }
}
/** 邻接查询使用相同order/startDate/id字典序，NULL排末位。 */
function adjacentWhere(
  item: { order: number; startDate: Date | null; id: string },
  previous: boolean,
): Prisma.ProjectWhereInput {
  const compare = previous ? 'lt' : 'gt'
  const dates: Prisma.ProjectWhereInput[] = item.startDate
    ? [
        { startDate: { [previous ? 'gt' : 'lt']: item.startDate } },
        ...(previous ? [] : [{ startDate: null }]),
        { startDate: item.startDate, id: { [compare]: item.id } },
      ]
    : [
        ...(previous ? [{ startDate: { not: null } }] : []),
        { startDate: null, id: { [compare]: item.id } },
      ]
  return { OR: [{ order: { [compare]: item.order } }, { order: item.order, OR: dates }] }
}
export async function getPublicProject(slug: string) {
  const { module, where } = await publicWhere()
  if (!module?.enabled) throw missing()
  const item = await prisma.project.findFirst({ where: { ...where, slug }, include })
  if (!item) throw missing()
  const adjacency = (previous: boolean) =>
    prisma.project.findFirst({
      where: { ...where, AND: [adjacentWhere(item, previous)] },
      select: { id: true, slug: true, title: true, type: true, startDate: true, order: true },
      orderBy: previous
        ? [{ order: 'desc' }, { startDate: { sort: 'asc', nulls: 'first' } }, { id: 'desc' }]
        : defaultSort,
    })
  const [prev, next] = await Promise.all([adjacency(true), adjacency(false)])
  const { deletedAt: _deleted, ...value } = item
  return applyPublicPrivacy({ ...value, prev, next })
}
function adminWhere(params: URLSearchParams): Prisma.ProjectWhereInput {
  const status = params.has('status') ? params.get('status')!.split(',') : []
  if (status.some((value) => !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(value)))
    throw invalid('状态参数无效')
  return {
    deletedAt: params.get('includeDeleted') === 'true' ? { not: null } : null,
    ...(status.length ? { status: { in: status as ('DRAFT' | 'PUBLISHED' | 'ARCHIVED')[] } } : {}),
  }
}
export async function listAdminProjects(params = new URLSearchParams(), request?: Request) {
  await requirePermission('content:read', request)
  const fields = requestedFields(params, true),
    result = await list(filters(params, adminWhere(params)), params, 20)
  return { ...result, data: projectFields(result.data, fields) }
}
export async function getAdminProject(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const item = await prisma.project.findUnique({ where: { id }, include })
  if (!item) throw missing()
  return item
}
export async function getProjectOptions(request?: Request) {
  await requirePermission('content:read', request)
  const [tags, rows] = await Promise.all([
    prisma.tag.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, slug: true, color: true },
    }),
    prisma.project.findMany({ where: { deletedAt: null }, select: { techStack: true } }),
  ])
  return { tags, techStack: [...new Set(rows.flatMap((row) => row.techStack))].sort() }
}
export async function projectSlugAvailable(
  slug: string,
  excludeId: string | null,
  request?: Request,
) {
  await requirePermission('content:read', request)
  slugSchema.parse(slug)
  const found = await prisma.project.findUnique({ where: { slug }, select: { id: true } })
  return { available: !found || found.id === excludeId }
}
type ProjectWithTags = Prisma.ProjectGetPayload<{ include: typeof include }>
/** 仅记录真实变化字段；标签按集合比较，审计与关系修改同事务。 */
async function auditChanges(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  before: ProjectWithTags,
  after: ProjectWithTags,
) {
  const beforeValues = {
      ...before,
      tags: undefined,
      tagIds: before.tags.map((tag) => tag.id).sort(),
    },
    afterValues = { ...after, tags: undefined, tagIds: after.tags.map((tag) => tag.id).sort() }
  const changed = Object.keys(beforeValues).filter(
    (key) =>
      key !== 'updatedAt' &&
      JSON.stringify(beforeValues[key as keyof typeof beforeValues]) !==
        JSON.stringify(afterValues[key as keyof typeof afterValues]),
  )
  await writeAudit(tx, {
    userId,
    action,
    resource: 'project',
    resourceId: before.id,
    before: Object.fromEntries(
      changed.map((key) => [key, beforeValues[key as keyof typeof beforeValues]]),
    ),
    after: Object.fromEntries(
      changed.map((key) => [key, afterValues[key as keyof typeof afterValues]]),
    ),
  })
}
const dbLinks = (links: z.infer<typeof ProjectCreateSchema>['links']) =>
  links === null ? Prisma.DbNull : links
export async function createProject(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = ProjectCreateSchema.parse(input)
  if (body.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
    throw new ApiError(403, 'FORBIDDEN', '不能发布作品')
  const { tagIds, links, ...data } = body
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        ...data,
        links: dbLinks(links),
        coverImage: data.coverImage === undefined ? (data.gallery[0] ?? null) : data.coverImage,
        publishedAt:
          data.status === 'PUBLISHED' ? (data.publishedAt ?? new Date()) : data.publishedAt,
        tags: { connect: [...new Set(tagIds)].map((id) => ({ id })) },
      },
      include,
    })
    await writeAudit(tx, {
      userId: user.id,
      action: 'create',
      resource: 'project',
      resourceId: created.id,
      after: { ...created, tags: undefined, tagIds: created.tags.map((tag) => tag.id) },
    })
    return created
  })
  invalidateContent('project')
  return item
}
async function writeProject(id: string, input: unknown, request?: Request, auditAction?: string) {
  const user = await requirePermission('content:write', request),
    { revision, tagIds, links, ...data } = ProjectUpdateSchema.parse(input)
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id }, include })
    if (!before || before.deletedAt) throw missing()
    if (before.revision !== revision) throw conflict()
    if (
      (data.status === 'PUBLISHED' || before.status === 'PUBLISHED') &&
      !user.permissions.includes('content:publish')
    )
      throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
    const startDate = data.startDate === undefined ? before.startDate : data.startDate,
      endDate = data.endDate === undefined ? before.endDate : data.endDate
    if (startDate && endDate && endDate < startDate) throw invalid('结束日期不能早于开始日期')
    const status = data.status ?? before.status,
      publishedAt = data.publishedAt === undefined ? before.publishedAt : data.publishedAt
    const result = await tx.project.updateMany({
      where: { id, revision, deletedAt: null },
      data: {
        ...data,
        ...(links === undefined ? {} : { links: dbLinks(links) }),
        publishedAt: status === 'PUBLISHED' ? (publishedAt ?? new Date()) : publishedAt,
        revision: { increment: 1 },
      },
    })
    if (!result.count) throw conflict()
    const updated = await tx.project.update({
      where: { id },
      data:
        tagIds === undefined ? {} : { tags: { set: [...new Set(tagIds)].map((id) => ({ id })) } },
      include,
    })
    await auditChanges(
      tx,
      user.id,
      auditAction ??
        (data.status === 'PUBLISHED'
          ? 'publish'
          : data.status === 'DRAFT'
            ? 'unpublish'
            : data.status === 'ARCHIVED'
              ? 'archive'
              : 'update'),
      before,
      updated,
    )
    return updated
  })
  invalidateContent('project')
  return item
}
export const updateProject = (id: string, input: unknown, request?: Request) =>
  writeProject(id, input, request)
async function changeDeleted(id: string, revision: number, restore: boolean, request?: Request) {
  const user = await requirePermission('content:write', request)
  ProjectRevisionSchema.parse({ revision })
  const item = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id }, include })
    if (!before) throw missing()
    if (before.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
      throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
    const result = await tx.project.updateMany({
      where: { id, revision, deletedAt: restore ? { not: null } : null },
      data: { deletedAt: restore ? null : new Date(), revision: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    const updated = await tx.project.findUniqueOrThrow({ where: { id }, include })
    await auditChanges(tx, user.id, restore ? 'restore' : 'delete', before, updated)
    return updated
  })
  invalidateContent('project')
  return item
}
export const deleteProject = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, false, request)
export const restoreProject = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, true, request)
export async function purgeProject(id: string, revision: number, request?: Request) {
  const user = await requirePermission('content:write', request)
  if (user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '只有管理员可以彻底删除')
  ProjectRevisionSchema.parse({ revision })
  await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id }, include })
    if (!before) throw missing()
    const result = await tx.project.deleteMany({
      where: { id, revision, deletedAt: { not: null } },
    })
    if (!result.count) throw conflict()
    await tx.previewToken.deleteMany({ where: { kind: 'project', contentId: id } })
    await writeAudit(tx, {
      userId: user.id,
      action: 'purge',
      resource: 'project',
      resourceId: id,
      before: { ...before, tags: undefined, tagIds: before.tags.map((tag) => tag.id) },
    })
  })
  invalidateContent('project')
}
export async function bulkProjects(input: unknown, request?: Request) {
  await requirePermission('content:write', request)
  const body = ProjectBulkSchema.parse(input),
    succeeded: string[] = [],
    failed: { id: string; code: string; message: string }[] = []
  for (const id of [...new Set(body.ids)]) {
    try {
      const revision = body.revisions[id]
      if (body.action === 'delete') await deleteProject(id, revision, request)
      else if (body.action === 'restore') await restoreProject(id, revision, request)
      else if (body.action === 'addTags' || body.action === 'removeTags') {
        const existing = await getAdminProject(id, request),
          requested = body.payload!.tagIds
        const tagIds =
          body.action === 'addTags'
            ? [...new Set([...existing.tags.map((tag) => tag.id), ...requested])]
            : existing.tags.map((tag) => tag.id).filter((tag) => !requested.includes(tag))
        await writeProject(id, { revision, tagIds }, request, body.action)
      } else
        await updateProject(
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
        failed.push({ id, code: 'NOT_FOUND', message: '作品或标签不存在' })
      else if (error instanceof z.ZodError)
        failed.push({ id, code: 'VALIDATION_ERROR', message: '输入格式不正确' })
      else throw error
    }
  }
  return { succeeded, failed }
}
export async function reorderProjects(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = ProjectReorderSchema.parse(input)
  const items = await prisma.$transaction(async (tx) => {
    const updated: ProjectWithTags[] = []
    // 所有重排按id统一加锁顺序，反向拖动不会形成互锁。
    for (const item of [...body.items].sort((a, b) => a.id.localeCompare(b.id))) {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${item.id} FOR UPDATE`
      const before = await tx.project.findUnique({ where: { id: item.id }, include })
      if (!before || before.deletedAt) throw missing()
      if (before.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
        throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
      const result = await tx.project.updateMany({
        where: { id: item.id, revision: item.revision, deletedAt: null },
        data: { order: item.order, revision: { increment: 1 } },
      })
      if (!result.count) throw conflict()
      const after = await tx.project.findUniqueOrThrow({ where: { id: item.id }, include })
      await auditChanges(tx, user.id, 'reorder', before, after)
      updated.push(after)
    }
    return body.items.map((item) => updated.find((row) => row.id === item.id)!)
  })
  invalidateContent('project')
  return { items }
}
async function requireProjectModule() {
  const projectModule = await prisma.module.findUnique({ where: { key: 'portfolio' } })
  if (!projectModule?.enabled) throw missing()
}
export async function createProjectPreviewToken(id: string, request?: Request) {
  const user = await requirePermission('content:read', request)
  // 只读角色的预览凭据创建也共享后台写额度，Origin在授权服务核验。
  await consumeRateLimit('adminwrite:' + user.id, 120, 900000)
  await requireProjectModule()
  if (!(await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true } })))
    throw missing()
  const token = randomBytes(32).toString('base64url'),
    expiresAt = new Date(Date.now() + 86400000)
  await prisma.previewToken.create({
    data: {
      hash: createHash('sha256').update(token).digest('hex'),
      kind: 'project',
      contentId: id,
      expiresAt,
    },
  })
  return { token, url: `/preview/${token}`, expiresAt }
}
export async function getPreviewProject(token: string) {
  await requireProjectModule()
  const preview = await prisma.previewToken.findUnique({
    where: { hash: createHash('sha256').update(token).digest('hex') },
  })
  if (!preview || preview.kind !== 'project' || preview.expiresAt <= new Date()) throw missing()
  const item = await prisma.project.findFirst({
    where: { id: preview.contentId, deletedAt: null },
    include,
  })
  if (!item) throw missing()
  return item
}
