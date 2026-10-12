import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
export function clearExpiredRotationReplies(tx: Prisma.TransactionClient) {
  // JS时间精度为毫秒，恰好10000ms仍允许复用同一回复。
  return tx.$executeRaw`UPDATE sessions SET "rotationReply" = NULL WHERE "rotationReply" IS NOT NULL AND "rotatedAt" < date_trunc('milliseconds', CURRENT_TIMESTAMP) - INTERVAL '10 seconds'`
}
/** 只清过期运维记录；旧RT摘要保留至过期以继续检测重放。 */
export async function processMaintenance() {
  return prisma.$transaction(
    async (tx) => {
      const [lease] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(191071002) AS locked`
      if (!lease.locked) return { skipped: true }
      const sessions =
        await tx.$executeRaw`DELETE FROM sessions WHERE "expiresAt" <= CURRENT_TIMESTAMP`
      const rotationReplies = await clearExpiredRotationReplies(tx)
      const previews =
        await tx.$executeRaw`DELETE FROM preview_tokens WHERE "expiresAt" <= CURRENT_TIMESTAMP`
      const rateLimits =
        await tx.$executeRaw`DELETE FROM rate_limits WHERE "expiresAt" <= CURRENT_TIMESTAMP`
      // 不能按30分钟去重窗口删除，否则同日UV会重复累计。
      const viewReceipts =
        await tx.$executeRaw`DELETE FROM view_receipts WHERE "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '30 days'`
      return { skipped: false, sessions, rotationReplies, previews, rateLimits, viewReceipts }
    },
    { maxWait: 2000, timeout: 10000 },
  )
}
