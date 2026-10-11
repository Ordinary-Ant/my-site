import 'server-only'
import { Prisma, type Category, type Tag } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import { requirePermission } from './auth'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'
import { invalidateContent } from './cache'
import { applyPublicPrivacy } from './public-site'
import {
  CategoryCreateSchema,
  CategoryUpdateSchema,
  CategoryReorderSchema,
  TagCreateSchema,
  TagUpdateSchema,
  TaxonomyRevisionSchema,
  TaxonomyBulkSchema,
  TaxonomyMergeSchema,
} from '@/lib/validators/taxonomy'
import { logTypes } from '@/lib/validators/log'
import { projectTypes } from '@/lib/validators/project'
import { publicLogWhere } from './log'
export type TaxonomyCounts = { article: number; log: number; project: number; total: number }
export type CategoryNode = Category & {
  articleCount: number
  totalCount: number
  children: CategoryNode[]
}
export type TagItem = Tag & { counts: TaxonomyCounts }
const missing = () => new ApiError(404, 'NOT_FOUND', '分类或标签不存在')
const conflict = () => new ApiError(409, 'REVISION_CONFLICT', '数据已修改，请刷新后比较最新版本')
const rule = (message: string) => new ApiError(422, 'BUSINESS_RULE_VIOLATION', message)
const invalid = (message: string) => new ApiError(400, 'VALIDATION_ERROR', message)
const counts = (article = 0, log = 0, project = 0): TaxonomyCounts => ({
  article,
  log,
  project,
  total: article + log + project,
})
async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ApiError(409, 'SLUG_CONFLICT', 'slug已被使用')
      if (
        ['P2034', 'P2025', 'P2003'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
      )
        throw conflict()
    }
    throw error
  }
}
function invalidate() {
  for (const name of ['category', 'tag', 'article', 'log', 'project']) invalidateContent(name)
}
async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  resource: string,
  action: string,
  before: unknown,
  after: unknown,
  resourceId?: string,
) {
  await writeAudit(tx, { userId, resource, action, resourceId, before, after })
}
function tree(rows: (Category & { articleCount: number })[]): CategoryNode[] {
  const map = new Map(
    rows.map((row) => [
      row.id,
      { ...row, totalCount: row.articleCount, children: [] } as CategoryNode,
    ]),
  )
  const roots: CategoryNode[] = []
  for (const row of map.values()) {
    const parent = row.parentId ? map.get(row.parentId) : null
    if (parent) parent.children.push(row)
    else roots.push(row)
  }
  const total = (node: CategoryNode): number =>
    (node.totalCount = node.articleCount + node.children.reduce((n, c) => n + total(c), 0))
  roots.forEach(total)
  return roots
}
const categoryFields = [
  'id',
  'name',
  'slug',
  'description',
  'icon',
  'color',
  'parentId',
  'order',
  'revision',
  'createdAt',
  'updatedAt',
  'articleCount',
  'totalCount',
  'children',
]
const tagFields = ['id', 'name', 'slug', 'color', 'revision', 'createdAt', 'counts']
function fields(params: URLSearchParams, allowed: string[]) {
  if (!params.has('fields')) return null
  const values = params.get('fields')!.split(',')
  if (values.some((v) => !allowed.includes(v))) throw invalid('字段参数无效')
  return values
}
function project<T extends object>(items: T[], selected: string[] | null): T[] {
  return selected
    ? items.map(
        (item) => Object.fromEntries(selected.map((key) => [key, item[key as keyof T]])) as T,
      )
    : items
}
async function publicConditions() {
  const modules = await prisma.module.findMany({
    where: { key: { in: ['article', 'log', 'portfolio'] } },
  })
  const enabled = (key: string) => modules.find((m) => m.key === key)?.enabled ?? false
  const types = (key: string, values: readonly string[]) => {
    const config = modules.find((m) => m.key === key)?.config as {
      types?: Record<string, boolean>
    } | null
    return values.filter((type) => config?.types?.[type] !== false)
  }
  const base = { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() }, deletedAt: null }
  return {
    article: {
      ...base,
      ...(!enabled('article') ? { id: { in: [] } } : {}),
    } satisfies Prisma.ArticleWhereInput,
    log: {
      // 词表计数与日志详情共享日期边界，不能暴露尚不可读的未来日志。
      ...publicLogWhere(types('log', logTypes)),
      ...(!enabled('log') ? { id: { in: [] } } : {}),
    } satisfies Prisma.LogWhereInput,
    project: {
      ...base,
      type: { in: types('portfolio', projectTypes) as (typeof projectTypes)[number][] },
      ...(!enabled('portfolio') ? { id: { in: [] } } : {}),
    } satisfies Prisma.ProjectWhereInput,
  }
}
export async function listPublicCategories(params = new URLSearchParams()) {
  const selected = fields(params, categoryFields),
    where = await publicConditions()
  const rows = await prisma.category.findMany({
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { articles: { where: where.article } } } },
  })
  const values = tree(rows.map(({ _count, ...row }) => ({ ...row, articleCount: _count.articles })))
  const prune = (nodes: CategoryNode[]): CategoryNode[] =>
    nodes.filter((n) => n.totalCount > 0).map((n) => ({ ...n, children: prune(n.children) }))
  return applyPublicPrivacy(project(prune(values), selected))
}
export async function listAdminCategories(request?: Request) {
  await requirePermission('content:read', request)
  const rows = await prisma.category.findMany({
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { articles: true } } },
  })
  return tree(rows.map(({ _count, ...row }) => ({ ...row, articleCount: _count.articles })))
}
export async function getAdminCategory(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const item = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { articles: true, children: true } } },
  })
  if (!item) throw missing()
  return { ...item, articleCount: item._count.articles, childCount: item._count.children }
}
async function lockCategories(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM categories ORDER BY id FOR UPDATE`
}
async function parentValid(tx: Prisma.TransactionClient, parentId: string | null, id?: string) {
  if (!parentId) return
  if (parentId === id) throw rule('分类不能指向自身')
  const parent = await tx.category.findUnique({ where: { id: parentId } })
  if (!parent) throw missing()
  if (parent.parentId) throw rule('分类最多支持两层，父分类必须为根')
  if (id && (await tx.category.count({ where: { parentId: id } })))
    throw rule('含子分类的根不能移入另一分类')
}
export async function createCategory(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = CategoryCreateSchema.parse(input)
  const item = await transaction(async (tx) => {
    await lockCategories(tx)
    await parentValid(tx, body.parentId)
    const row = await tx.category.create({ data: body })
    await audit(tx, user.id, 'category', 'create', undefined, row, row.id)
    return row
  })
  invalidate()
  return item
}
export async function updateCategory(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { revision, ...data } = CategoryUpdateSchema.parse(input)
  const item = await transaction(async (tx) => {
    await lockCategories(tx)
    const before = await tx.category.findUnique({ where: { id } })
    if (!before) throw missing()
    if (before.revision !== revision) throw conflict()
    await parentValid(tx, data.parentId === undefined ? before.parentId : data.parentId, id)
    const changed = await tx.category.updateMany({
      where: { id, revision },
      data: { ...data, revision: { increment: 1 } },
    })
    if (!changed.count) throw conflict()
    const row = await tx.category.findUniqueOrThrow({ where: { id } })
    await audit(tx, user.id, 'category', 'update', before, row, id)
    return row
  })
  invalidate()
  return item
}
export async function deleteCategory(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { revision } = TaxonomyRevisionSchema.parse(input)
  const result = await transaction(async (tx) => {
    await lockCategories(tx)
    const before = await tx.category.findUnique({ where: { id } })
    if (!before) throw missing()
    if (before.revision !== revision) throw conflict()
    if (await tx.category.count({ where: { parentId: id } })) throw rule('请先管理子分类')
    await tx.$queryRaw`SELECT id FROM articles WHERE "categoryId"=${id} ORDER BY id FOR UPDATE`
    const affected = await tx.article.updateMany({
      where: { categoryId: id },
      data: { categoryId: null, revision: { increment: 1 } },
    })
    if (!(await tx.category.deleteMany({ where: { id, revision } })).count) throw conflict()
    await audit(tx, user.id, 'category', 'delete', before, { affected: affected.count }, id)
    return { id, affected: affected.count }
  })
  invalidate()
  return result
}
export async function reorderCategories(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { items } = CategoryReorderSchema.parse(input)
  const result = await transaction(async (tx) => {
    await lockCategories(tx)
    const rows = await tx.category.findMany({ where: { id: { in: items.map((i) => i.id) } } })
    if (rows.length !== items.length) throw missing()
    if (new Set(rows.map((r) => r.parentId)).size !== 1) throw rule('只能对同父分类排序')
    for (const item of items) {
      if (
        !(
          await tx.category.updateMany({
            where: { id: item.id, revision: item.revision },
            data: { order: item.order, revision: { increment: 1 } },
          })
        ).count
      )
        throw conflict()
    }
    await audit(tx, user.id, 'category', 'reorder', rows, items)
    return tx.category.findMany({
      where: { id: { in: items.map((i) => i.id) } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
  })
  invalidate()
  return result
}
function tagDto(
  row: Tag & { _count: { articles: number; logs: number; projects: number } },
): TagItem {
  const { _count, ...tag } = row
  return { ...tag, counts: counts(_count.articles, _count.logs, _count.projects) }
}
const fullCounts = { _count: { select: { articles: true, logs: true, projects: true } } } as const
function paging(params: URLSearchParams) {
  const integer = (key: string, fallback: number, max: number) => {
    const value = params.get(key)
    if (value === null) return fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      throw invalid('分页参数无效')
    return Number(value)
  }
  return { page: integer('page', 1, 100000), pageSize: integer('pageSize', 20, 100) }
}
async function tagList(params: URLSearchParams, isPublic: boolean) {
  const { page, pageSize } = paging(params),
    selected = fields(params, tagFields)
  const sort = params.get('sort') ?? 'usage'
  if (!['usage', 'name', 'newest'].includes(sort)) throw invalid('排序参数无效')
  const q = params.get('q') ?? ''
  if (q.length > 200) throw invalid('搜索过长')
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { slug: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {}
  const conditions = isPublic ? await publicConditions() : null
  const rows = await prisma.tag.findMany({
    where,
    include: conditions
      ? {
          _count: {
            select: {
              articles: { where: conditions.article },
              logs: { where: conditions.log },
              projects: { where: conditions.project },
            },
          },
        }
      : fullCounts,
  })
  let data = rows.map(tagDto)
  if (isPublic) data = data.filter((x) => x.counts.total > 0)
  data.sort(
    (a, b) =>
      (sort === 'usage'
        ? b.counts.total - a.counts.total
        : sort === 'newest'
          ? b.createdAt.getTime() - a.createdAt.getTime()
          : a.name.localeCompare(b.name)) || a.id.localeCompare(b.id),
  )
  const total = data.length
  data = data.slice((page - 1) * pageSize, page * pageSize)
  const safe = isPublic ? await applyPublicPrivacy(data) : data
  return {
    data: project(safe, selected),
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
export async function listPublicTags(params = new URLSearchParams()) {
  return tagList(params, true)
}
export async function listAdminTags(params = new URLSearchParams(), request?: Request) {
  await requirePermission('content:read', request)
  return tagList(params, false)
}
export async function getAdminTag(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const row = await prisma.tag.findUnique({ where: { id }, include: fullCounts })
  if (!row) throw missing()
  return tagDto(row)
}
export async function createTag(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = TagCreateSchema.parse(input)
  const row = await transaction(async (tx) => {
    const item = await tx.tag.create({ data: body })
    await audit(tx, user.id, 'tag', 'create', undefined, item, item.id)
    return item
  })
  invalidate()
  return { ...row, counts: counts() }
}
export async function updateTag(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { revision, ...data } = TagUpdateSchema.parse(input)
  const row = await transaction(async (tx) => {
    const before = await tx.tag.findUnique({ where: { id } })
    if (!before) throw missing()
    if (
      !(
        await tx.tag.updateMany({
          where: { id, revision },
          data: { ...data, revision: { increment: 1 } },
        })
      ).count
    )
      throw conflict()
    const item = await tx.tag.findUniqueOrThrow({ where: { id }, include: fullCounts })
    await audit(tx, user.id, 'tag', 'update', before, item, id)
    return tagDto(item)
  })
  invalidate()
  return row
}
type Versioned = { id: string; revision: number }
async function lockTags(tx: Prisma.TransactionClient, items: Versioned[]) {
  const ids = items.map((i) => i.id).sort()
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM tags WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  )
  const rows = await tx.tag.findMany({ where: { id: { in: ids } }, include: fullCounts })
  if (rows.length !== ids.length) throw missing()
  if (items.some((i) => rows.find((r) => r.id === i.id)!.revision !== i.revision)) throw conflict()
  return rows.map(tagDto)
}
// 固定模型及ID顺序锁正文；旧编辑稿CAS在关系转移后必须冲突。
async function affectedRows(tx: Prisma.TransactionClient, ids: string[]) {
  for (const [table, join] of [
    ['articles', '_ArticleTags'],
    ['logs', '_LogTags'],
    ['projects', '_ProjectTags'],
  ] as const) {
    await tx.$queryRaw(
      Prisma.sql`SELECT c.id FROM ${Prisma.raw(table)} c WHERE EXISTS(SELECT 1 FROM ${Prisma.raw('"' + join + '"')} r WHERE r."A"=c.id AND r."B" IN (${Prisma.join(ids)})) ORDER BY c.id FOR UPDATE`,
    )
  }
  const where = { tags: { some: { id: { in: ids } } } },
    include = { tags: { select: { id: true } } }
  const [articles, logs, projects] = await Promise.all([
    tx.article.findMany({ where, include }),
    tx.log.findMany({ where, include }),
    tx.project.findMany({ where, include }),
  ])
  return { articles, logs, projects }
}
async function mergePlan(tx: Prisma.TransactionClient, body: z.infer<typeof TaxonomyMergeSchema>) {
  const metadata = await lockTags(tx, [body.target, ...body.sources]),
    rows = await affectedRows(
      tx,
      body.sources.map((s) => s.id),
    ),
    target = metadata.find((t) => t.id === body.target.id)!
  const affected = counts(rows.articles.length, rows.logs.length, rows.projects.length)
  const addition = (items: { tags: { id: string }[] }[]) =>
    items.filter((row) => !row.tags.some((t) => t.id === target.id)).length
  return {
    target,
    sources: metadata.filter((t) => t.id !== target.id),
    affected,
    additions: counts(addition(rows.articles), addition(rows.logs), addition(rows.projects)),
    rows,
  }
}
export async function previewTagMerge(input: unknown, request?: Request) {
  const user = await requirePermission('content:read', request)
  // 预览需要锁关系和正文，即使只读角色也共用管理写请求额度。
  await consumeRateLimit(`adminwrite:${user.id}`, 120, 900000)
  const body = TaxonomyMergeSchema.parse(input)
  return transaction(async (tx) => {
    const { rows: _rows, ...plan } = await mergePlan(tx, body)
    return plan
  })
}
async function changeRelations(
  tx: Prisma.TransactionClient,
  rows: Awaited<ReturnType<typeof affectedRows>>,
  sourceIds: string[],
  targetId?: string,
) {
  const sources = new Set(sourceIds)
  for (const row of rows.articles) {
    const ids = [
      ...new Set([
        ...row.tags.filter((t) => !sources.has(t.id)).map((t) => t.id),
        ...(targetId ? [targetId] : []),
      ]),
    ]
    if (
      !(
        await tx.article.updateMany({
          where: { id: row.id, revision: row.revision },
          data: { revision: { increment: 1 } },
        })
      ).count
    )
      throw conflict()
    await tx.article.update({
      where: { id: row.id },
      data: { tags: { set: ids.map((id) => ({ id })) } },
    })
  }
  for (const row of rows.logs) {
    const ids = [
      ...new Set([
        ...row.tags.filter((t) => !sources.has(t.id)).map((t) => t.id),
        ...(targetId ? [targetId] : []),
      ]),
    ]
    if (
      !(
        await tx.log.updateMany({
          where: { id: row.id, revision: row.revision },
          data: { revision: { increment: 1 } },
        })
      ).count
    )
      throw conflict()
    await tx.log.update({
      where: { id: row.id },
      data: { tags: { set: ids.map((id) => ({ id })) } },
    })
  }
  for (const row of rows.projects) {
    const ids = [
      ...new Set([
        ...row.tags.filter((t) => !sources.has(t.id)).map((t) => t.id),
        ...(targetId ? [targetId] : []),
      ]),
    ]
    if (
      !(
        await tx.project.updateMany({
          where: { id: row.id, revision: row.revision },
          data: { revision: { increment: 1 } },
        })
      ).count
    )
      throw conflict()
    await tx.project.update({
      where: { id: row.id },
      data: { tags: { set: ids.map((id) => ({ id })) } },
    })
  }
}
export async function mergeTags(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    body = TaxonomyMergeSchema.parse(input)
  const result = await transaction(async (tx) => {
    const { rows, ...plan } = await mergePlan(tx, body)
    await changeRelations(
      tx,
      rows,
      body.sources.map((s) => s.id),
      body.target.id,
    )
    if (
      !(
        await tx.tag.updateMany({
          where: { id: body.target.id, revision: body.target.revision },
          data: { revision: { increment: 1 } },
        })
      ).count
    )
      throw conflict()
    for (const source of body.sources) {
      if (!(await tx.tag.deleteMany({ where: source })).count) throw conflict()
    }
    const target = tagDto(
      await tx.tag.findUniqueOrThrow({ where: { id: body.target.id }, include: fullCounts }),
    )
    await audit(
      tx,
      user.id,
      'tag',
      'merge',
      plan,
      { target, affected: plan.affected, additions: plan.additions },
      target.id,
    )
    return { ...plan, target }
  })
  invalidate()
  return result
}
export async function bulkDeleteTags(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request),
    { items } = TaxonomyBulkSchema.parse(input)
  const result = await transaction(async (tx) => {
    const before = await lockTags(tx, items),
      ids = items.map((i) => i.id),
      rows = await affectedRows(tx, ids)
    await changeRelations(tx, rows, ids)
    for (const item of items) {
      if (!(await tx.tag.deleteMany({ where: item })).count) throw conflict()
    }
    const affected = counts(rows.articles.length, rows.logs.length, rows.projects.length)
    await audit(tx, user.id, 'tag', 'delete', before, { ids, affected })
    return { ids, affected }
  })
  invalidate()
  return result
}
export async function deleteTag(id: string, input: unknown, request?: Request) {
  const { revision } = TaxonomyRevisionSchema.parse(input)
  return bulkDeleteTags({ items: [{ id, revision }] }, request)
}
