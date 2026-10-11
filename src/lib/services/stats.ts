import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { publicContentScope } from './public-content'
import { assertOrigin, requestInfo, requirePermission } from './auth'
import { consumeRateLimit } from './rate-limit'
import { issueVisitor, readVisitor, skipViewRequest } from '@/lib/visitor'
export const ViewInput = z
  .object({ resource: z.enum(['article', 'log', 'project']), id: z.string().min(1).max(200) })
  .strict()
type Resource = z.infer<typeof ViewInput>['resource']
const dayOf = (now: Date) =>
  new Date(new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z')

/** PG锁后读数据库时间，receipt/日汇总/内容阅读量在同一事务提交。 */
export async function countPublicView(resource: Resource, id: string, visitorHash: string) {
  ViewInput.parse({ resource, id })
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(visitorHash)
  // 标识符只由固定枚举选取，用户输入始终作为参数绑定。
  const table = Prisma.raw(
    resource === 'article' ? 'articles' : resource === 'log' ? 'logs' : 'projects',
  )
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${resource + ':' + id}),hashtext(${visitorHash}))`
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id=${id} FOR UPDATE`)
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now
      const date = dayOf(now),
        scope = await publicContentScope(tx, now)
      if (
        !scope.modules.some(
          (m) => m.key === (resource === 'project' ? 'portfolio' : resource) && m.enabled,
        )
      )
        throw new ApiError(404, 'NOT_FOUND', '公开内容不存在')
      const item =
        resource === 'article'
          ? await tx.article.findFirst({
              where: { ...scope.article, id },
              select: { id: true, slug: true, viewCount: true },
            })
          : resource === 'log'
            ? await tx.log.findFirst({
                where: { ...scope.log, id },
                select: { id: true, viewCount: true },
              })
            : await tx.project.findFirst({
                where: { ...scope.project, id },
                select: { id: true, slug: true, viewCount: true },
              })
      if (!item) throw new ApiError(404, 'NOT_FOUND', '公开内容不存在')
      const key = { resource, contentId: id, visitorHash },
        receipt = await tx.viewReceipt.findUnique({
          where: { resource_contentId_visitorHash: key },
        })
      if (receipt && receipt.windowExpiresAt > now)
        return { counted: false, viewCount: item.viewCount }
      const unique = !receipt || receipt.countedDate.getTime() !== date.getTime()
      const path =
        scope.modules.find((m) => m.key === (resource === 'project' ? 'portfolio' : resource))!
          .route +
        '/' +
        ('slug' in item ? item.slug : item.id)
      // raw递增避开Prisma @updatedAt：阅读不应制造编辑冲突或改变修改时间。
      const updated = await tx.$queryRaw<{ viewCount: number }[]>(
        Prisma.sql`UPDATE ${table} SET "viewCount"="viewCount"+1 WHERE id=${id} RETURNING "viewCount"`,
      )
      await tx.dailyStat.upsert({
        where: { date_resource_contentId: { date, resource, contentId: id } },
        create: {
          id: randomUUID(),
          date,
          resource,
          contentId: id,
          path,
          views: 1,
          uniques: unique ? 1 : 0,
        },
        update: { path, views: { increment: 1 }, uniques: { increment: unique ? 1 : 0 } },
      })
      await tx.viewReceipt.upsert({
        where: { resource_contentId_visitorHash: key },
        create: {
          ...key,
          countedDate: date,
          windowExpiresAt: new Date(now.getTime() + 1800000),
          updatedAt: now,
        },
        update: {
          countedDate: date,
          windowExpiresAt: new Date(now.getTime() + 1800000),
          updatedAt: now,
        },
      })
      return { counted: true, viewCount: updated[0].viewCount }
    },
    { maxWait: 5000, timeout: 15000 },
  )
}

export async function recordPublicView(input: unknown, request: Request) {
  await assertOrigin(request)
  const body = ViewInput.parse(input)
  await consumeRateLimit(`public:${requestInfo(request).ip}`, 300, 900000)
  if (skipViewRequest(request.headers))
    return { data: { counted: false, viewCount: null }, cookie: null }
  const supplied = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('site_visitor='))
    ?.slice('site_visitor='.length)
  const valid = readVisitor(supplied, env.JWT_SECRET),
    cookie = valid ? null : issueVisitor(env.JWT_SECRET)
  const hash = valid ?? readVisitor(cookie!, env.JWT_SECRET)!
  await consumeRateLimit(`views:${hash}`, 60, 1800000)
  return { data: await countPublicView(body.resource, body.id, hash), cookie }
}

/** 管理统计展示真实来源；未配置备份时保留null，不编造时间。 */
export async function getAdminStats(request?: Request) {
  await requirePermission('dashboard:read', request)
  return prisma.$transaction(
    async (tx) => {
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now,
        today = dayOf(now),
        from = new Date(today.getTime() - 6 * 86400000)
      const scope = await publicContentScope(tx, now)
      const [
        articles,
        logs,
        projects,
        timeline,
        media,
        modules,
        daily,
        top,
        recentArticles,
        newArticles,
        newLogs,
        newProjects,
      ] = await Promise.all([
        tx.article.findMany({
          where: { deletedAt: null },
          select: { status: true, publishedAt: true },
        }),
        tx.log.findMany({
          where: { deletedAt: null },
          select: { status: true, publishedAt: true },
        }),
        tx.project.findMany({
          where: { deletedAt: null },
          select: { status: true, publishedAt: true },
        }),
        tx.timelineItem.count({ where: { deletedAt: null } }),
        tx.media.aggregate({ _count: true, _sum: { size: true } }),
        tx.module.findMany({ select: { enabled: true } }),
        tx.dailyStat.groupBy({
          by: ['date'],
          where: { date: { gte: from, lte: today } },
          _sum: { views: true, uniques: true },
          orderBy: { date: 'asc' },
        }),
        tx.article.findMany({
          where: scope.article,
          orderBy: [{ viewCount: 'desc' }, { id: 'asc' }],
          take: 5,
          select: { id: true, slug: true, title: true, viewCount: true },
        }),
        tx.article.findMany({
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { id: true, title: true, status: true },
        }),
        tx.article.count({ where: { deletedAt: null, createdAt: { gte: from, lte: now } } }),
        tx.log.count({ where: { deletedAt: null, createdAt: { gte: from, lte: now } } }),
        tx.project.count({ where: { deletedAt: null, createdAt: { gte: from, lte: now } } }),
      ])
      const counts = (items: { status: string; publishedAt: Date | null }[]) => ({
        total: items.length,
        published: items.filter(
          (i) => i.status === 'PUBLISHED' && i.publishedAt && i.publishedAt <= now,
        ).length,
        draft: items.filter((i) => i.status === 'DRAFT').length,
        archived: items.filter((i) => i.status === 'ARCHIVED').length,
        scheduled: items.filter(
          (i) => i.status === 'PUBLISHED' && (!i.publishedAt || i.publishedAt > now),
        ).length,
      })
      return {
        counts: {
          articles: counts(articles),
          logs: counts(logs),
          projects: counts(projects),
          timeline: { total: timeline },
          media: { total: media._count, totalSizeBytes: media._sum.size ?? 0 },
        },
        recent: {
          viewsLast7Days: daily.reduce((sum, row) => sum + (row._sum.views ?? 0), 0),
          newContentLast7Days: newArticles + newLogs + newProjects,
          topArticles: top.map((item) => ({
            ...item,
            url: scope.modules.find((m) => m.key === 'article')!.route + '/' + item.slug,
          })),
          articles: recentArticles,
        },
        traffic: Array.from({ length: 7 }, (_, i) => {
          const date = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10),
            row = daily.find((d) => d.date.toISOString().slice(0, 10) === date)
          return { date, views: row?._sum.views ?? 0, resourceUniques: row?._sum.uniques ?? 0 }
        }),
        system: {
          modulesEnabled: modules.filter((m) => m.enabled).length,
          modulesDisabled: modules.filter((m) => !m.enabled).length,
          dbStatus: 'ok',
          lastBackupAt: null,
        },
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
