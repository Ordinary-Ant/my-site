import 'server-only'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { pinyin } from 'pinyin-pro'
import { prisma } from '@/lib/prisma'
import { calcReadingTime } from '@/lib/utils'
import { getToc } from '@/lib/markdown-toc'
import { ArticleCreateSchema, ArticleUpdateSchema, slugSchema } from '@/lib/validators/article'
import { ApiError } from '@/lib/api/errors'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateContent } from './cache'

const include = {
  category: true,
  tags: true,
  author: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.ArticleInclude
export const publicArticleWhere = (): Prisma.ArticleWhereInput => ({
  status: 'PUBLISHED',
  deletedAt: null,
  publishedAt: { lte: new Date() },
})
const missing = () => new ApiError(404, 'NOT_FOUND', '文章不存在')
const conflict = () =>
  new ApiError(409, 'REVISION_CONFLICT', '内容已被其他窗口修改，请先比较最新版本')

export async function requireArticleModule() {
  const articleModule = await prisma.module.findUnique({ where: { key: 'article' } })
  if (!articleModule?.enabled) throw new ApiError(404, 'MODULE_DISABLED', '文章栏目未开放')
  return articleModule
}

function generateSlug(title: string) {
  const normalized = pinyin(title, { toneType: 'none', type: 'array' })
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${normalized.slice(0, 160) || 'article'}-${randomUUID().slice(0, 8)}`
}

/** 所有公开读取复用同一状态/时间/删除条件，后台请求不能改变过滤。 */
export async function listPublicArticles(params: URLSearchParams = new URLSearchParams()) {
  const articleModule = await prisma.module.findUnique({ where: { key: 'article' } })
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get('page')) || 1)))
  const pageSize = Math.max(
    1,
    Math.min(
      100,
      Math.floor(Number(params.get('pageSize')) || 0) ||
        (articleModule?.config as { pageSize?: number } | null)?.pageSize ||
        10,
    ),
  )
  if (!articleModule?.enabled)
    return {
      data: [],
      meta: { page, pageSize, total: 0, totalPages: 0, hasNext: false, hasPrev: page > 1 },
    }
  const where: Prisma.ArticleWhereInput = { ...publicArticleWhere() }
  const q = params.get('q')?.slice(0, 200)
  if (q)
    where.OR = ['title', 'summary', 'content'].map((field) => ({
      [field]: { contains: q, mode: 'insensitive' },
    }))
  if (params.get('category')) where.category = { slug: params.get('category')! }
  const tags = params.get('tag')?.split(',').filter(Boolean)
  if (tags?.length) where.AND = tags.map((slug) => ({ tags: { some: { slug } } }))
  const [items, total] = await prisma.$transaction([
    prisma.article.findMany({
      where,
      include,
      orderBy: [{ isTop: 'desc' }, { order: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.article.count({ where }),
  ])
  return {
    data: items.map(
      ({ content: _content, deletedAt: _deleted, authorId: _authorId, ...item }) => item,
    ),
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

export async function getPublicArticle(slug: string) {
  await requireArticleModule()
  const article = await prisma.article.findFirst({
    where: { ...publicArticleWhere(), slug },
    include,
  })
  if (!article) throw missing()
  return { ...article, toc: getToc(article.content) }
}

export async function listAdminArticles(params: URLSearchParams, request?: Request) {
  await requirePermission('content:read', request)
  const page = Math.max(1, Math.floor(Math.floor(Number(params.get('page')) || 1)))
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(params.get('pageSize')) || 20)))
  const where: Prisma.ArticleWhereInput = {
    deletedAt: params.get('includeDeleted') === 'true' ? { not: null } : null,
  }
  const status = params.get('status')
  if (status && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status))
    where.status = status as Prisma.EnumContentStatusFilter
  const q = params.get('q')?.slice(0, 200)
  if (q)
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { summary: { contains: q, mode: 'insensitive' } },
    ]
  const [data, total] = await prisma.$transaction([
    prisma.article.findMany({
      where,
      include,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.article.count({ where }),
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

export async function getAdminArticle(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const article = await prisma.article.findUnique({ where: { id }, include })
  if (!article) throw missing()
  return article
}

/** 创建和更新均在事务中维护标签、乐观锁与审计，统计字段只由服务端计算。 */
export async function createArticle(input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request)
  const body = ArticleCreateSchema.parse(input)
  if (body.status === 'PUBLISHED' && !user.permissions.includes('content:publish'))
    throw new ApiError(403, 'FORBIDDEN', '不能发布文章')
  const { tagIds, ...data } = body
  const article = await prisma.$transaction(async (tx) => {
    const created = await tx.article.create({
      data: {
        ...data,
        slug: data.slug ?? generateSlug(data.title),
        authorId: user.id,
        publishedAt:
          data.status === 'PUBLISHED' ? (data.publishedAt ?? new Date()) : data.publishedAt,
        ...calcReadingTime(data.content),
        tags: { connect: [...new Set(tagIds)].map((id) => ({ id })) },
      },
      include,
    })
    await writeAudit(tx, {
      userId: user.id,
      action: 'create',
      resource: 'article',
      resourceId: created.id,
      after: { title: created.title, status: created.status, revision: created.revision },
    })
    return created
  })
  invalidateContent('article')
  return article
}

export async function updateArticle(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('content:write', request)
  const { revision, tagIds, ...data } = ArticleUpdateSchema.parse(input)
  const article = await prisma.$transaction(async (tx) => {
    const before = await tx.article.findUnique({ where: { id } })
    if (!before || before.deletedAt) throw missing()
    if (before.revision !== revision) throw conflict()
    if (
      (data.status === 'PUBLISHED' || (before.status === 'PUBLISHED' && data.status !== 'DRAFT')) &&
      !user.permissions.includes('content:publish')
    )
      throw new ApiError(403, 'FORBIDDEN', '不能修改发布内容')
    const status = data.status ?? before.status
    const publishedAt = data.publishedAt === undefined ? before.publishedAt : data.publishedAt
    const result = await tx.article.updateMany({
      where: { id, revision, deletedAt: null },
      data: {
        ...data,
        publishedAt: status === 'PUBLISHED' ? (publishedAt ?? new Date()) : publishedAt,
        ...(data.content !== undefined ? calcReadingTime(data.content) : {}),
        revision: { increment: 1 },
      },
    })
    if (!result.count) throw conflict()
    const updated = await tx.article.update({
      where: { id },
      data:
        tagIds === undefined ? {} : { tags: { set: [...new Set(tagIds)].map((id) => ({ id })) } },
      include,
    })
    const changed = Object.keys(data)
    await writeAudit(tx, {
      userId: user.id,
      action:
        data.status === 'PUBLISHED' ? 'publish' : data.status === 'DRAFT' ? 'unpublish' : 'update',
      resource: 'article',
      resourceId: id,
      before: Object.fromEntries(changed.map((key) => [key, before[key as keyof typeof before]])),
      after: Object.fromEntries(changed.map((key) => [key, updated[key as keyof typeof updated]])),
    })
    return updated
  })
  invalidateContent('article')
  return article
}

async function changeDeleted(id: string, revision: number, restore: boolean, request?: Request) {
  const user = await requirePermission('content:write', request)
  if (!Number.isInteger(revision) || revision < 1)
    throw new ApiError(400, 'VALIDATION_ERROR', '需要有效revision')
  const article = await prisma.$transaction(async (tx) => {
    const before = await tx.article.findUnique({ where: { id } })
    if (!before) throw missing()
    const result = await tx.article.updateMany({
      where: { id, revision, deletedAt: restore ? { not: null } : null },
      data: { deletedAt: restore ? null : new Date(), revision: { increment: 1 } },
    })
    if (!result.count) throw conflict()
    await writeAudit(tx, {
      userId: user.id,
      action: restore ? 'restore' : 'delete',
      resource: 'article',
      resourceId: id,
      before: { deletedAt: before.deletedAt },
      after: { deletedAt: restore ? null : 'deleted' },
    })
    return tx.article.findUniqueOrThrow({ where: { id }, include })
  })
  invalidateContent('article')
  return article
}
export const deleteArticle = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, false, request)
export const restoreArticle = (id: string, revision: number, request?: Request) =>
  changeDeleted(id, revision, true, request)

export async function purgeArticle(id: string, revision: number, request?: Request) {
  const user = await requirePermission('content:write', request)
  if (user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '只有管理员可以彻底删除')
  if (!Number.isInteger(revision) || revision < 1)
    throw new ApiError(400, 'VALIDATION_ERROR', '需要有效revision')
  await prisma.$transaction(async (tx) => {
    const result = await tx.article.deleteMany({
      where: { id, revision, deletedAt: { not: null } },
    })
    if (!result.count) throw conflict()
    await tx.previewToken.deleteMany({ where: { contentId: id, kind: 'article' } })
    await writeAudit(tx, { userId: user.id, action: 'purge', resource: 'article', resourceId: id })
  })
  invalidateContent('article')
}

/** 预览凭据不放URL查询，不存明文；有效期24小时且读取仍尊重模块与删除状态。 */
export async function createPreviewToken(id: string, request?: Request) {
  await requirePermission('content:write', request)
  const article = await prisma.article.findFirst({ where: { id, deletedAt: null } })
  if (!article) throw missing()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 86400000)
  await prisma.previewToken.create({
    data: {
      hash: createHash('sha256').update(token).digest('hex'),
      kind: 'article',
      contentId: id,
      expiresAt,
    },
  })
  return { token, url: `/preview/${token}`, expiresAt }
}

export async function getPreviewArticle(token: string) {
  await requireArticleModule()
  const preview = await prisma.previewToken.findUnique({
    where: { hash: createHash('sha256').update(token).digest('hex') },
  })
  if (!preview || preview.kind !== 'article' || preview.expiresAt <= new Date()) throw missing()
  const article = await prisma.article.findFirst({
    where: { id: preview.contentId, deletedAt: null },
    include,
  })
  if (!article) throw missing()
  return article
}

export async function slugAvailable(slug: string, excludeId: string | null, request?: Request) {
  await requirePermission('content:read', request)
  slugSchema.parse(slug)
  const found = await prisma.article.findUnique({ where: { slug }, select: { id: true } })
  return { available: !found || found.id === excludeId }
}
