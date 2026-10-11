import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logTypes } from '@/lib/validators/log'
import { projectTypes } from '@/lib/validators/project'

/** 跨资源公开查询共同边界；允许事务客户端保证同一快照。 */
export async function publicContentScope(db: Prisma.TransactionClient = prisma, now = new Date()) {
  const modules = await db.module.findMany({
    where: { key: { in: ['article', 'log', 'portfolio'] } },
  })
  const enabled = (key: string) => modules.some((m) => m.key === key && m.enabled)
  const types = <T extends string>(key: string, values: readonly T[]) => {
    const config = modules.find((m) => m.key === key)?.config as {
      types?: Record<string, boolean>
    } | null
    return values.filter((type) => config?.types?.[type] !== false)
  }
  const base = { status: 'PUBLISHED' as const, deletedAt: null, publishedAt: { lte: now } }
  const day = new Date(
    new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z',
  )
  return {
    modules,
    article: {
      ...base,
      ...(!enabled('article') ? { id: { in: [] } } : {}),
    } satisfies Prisma.ArticleWhereInput,
    log: {
      ...base,
      type: { in: types('log', logTypes) },
      OR: [{ logDate: { lte: day } }, { isPinned: true }],
      ...(!enabled('log') ? { id: { in: [] } } : {}),
    } satisfies Prisma.LogWhereInput,
    project: {
      ...base,
      type: { in: types('portfolio', projectTypes) },
      ...(!enabled('portfolio') ? { id: { in: [] } } : {}),
    } satisfies Prisma.ProjectWhereInput,
  }
}
