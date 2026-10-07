import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { invalidateContent } from './cache'
const cursorKey = 'jobs.publication.cursor'

/** 外部调度只使用独立机器凭据，拒绝Cookie会话或空配置。 */
export function authorizePublicationJob(request: Request) {
  const expected = env.REVALIDATE_SECRET
  if (!expected || expected.length < 32)
    throw new ApiError(503, 'JOB_NOT_CONFIGURED', '发布调度未配置')
  const received = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  )
    throw new ApiError(401, 'UNAUTHORIZED', '调度凭据不正确')
}

/** 数据库游标和事务锁防止多实例重复调度；公开条件一直由发布时间控制。 */
export async function processDuePublications(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const [lease] = await tx.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(191071001) AS locked`
    if (!lease.locked) return { skipped: true, article: 0, log: 0, portfolio: 0 }
    const cursor = await tx.setting.findUnique({ where: { key: cursorKey } })
    const last = typeof cursor?.value === 'string' ? new Date(cursor.value) : new Date(0)
    const after = Number.isFinite(last.getTime()) && last <= now ? last : new Date(0)
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      publishedAt: { gt: after, lte: now },
    }
    const [article, log, portfolio] = await Promise.all([
      tx.article.count({ where }),
      tx.log.count({ where }),
      tx.project.count({ where }),
    ])
    // 失效失败时不推进游标，下一分钟可以安全重试。
    for (const [resource, count] of [
      ['article', article],
      ['log', log],
      ['portfolio', portfolio],
    ] as const)
      if (count) invalidateContent(resource)
    await tx.setting.upsert({
      where: { key: cursorKey },
      create: {
        key: cursorKey,
        value: now.toISOString(),
        group: 'integration',
        label: '发布调度内部游标',
      },
      update: { value: now.toISOString() },
    })
    await tx.previewToken.deleteMany({ where: { expiresAt: { lte: now } } })
    return { skipped: false, article, log, portfolio }
  })
}
