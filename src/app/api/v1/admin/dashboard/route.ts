import { apiHandler, ok } from '@/lib/api/http'
import { requirePermission } from '@/lib/services/auth'
import { prisma } from '@/lib/prisma'
/** 仪表盘查询真实数据库，不以演示数字替代业务统计。 */
export const GET = apiHandler(async (request) => {
  await requirePermission('dashboard:read', request)
  const [articles, drafts, logs, projects, media, recent] = await Promise.all([
    prisma.article.count({ where: { deletedAt: null } }),
    prisma.article.count({ where: { deletedAt: null, status: 'DRAFT' } }),
    prisma.log.count({ where: { deletedAt: null } }),
    prisma.project.count({ where: { deletedAt: null } }),
    prisma.media.count(),
    prisma.article.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
  ])
  return ok({ articles, drafts, logs, projects, media, recent })
})
