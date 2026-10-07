import 'server-only'
import type { Prisma, PrismaClient } from '@prisma/client'
const forbidden = /password|token|secret|authorization|cookie|rotationReply|refreshHash/i
function safe(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) return value.toISOString()
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value as Prisma.InputJsonValue
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : safe(v)))
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, v]) => v !== undefined && !forbidden.test(key))
        .map(([key, v]) => [key, safe(v)]),
    ) as Prisma.InputJsonObject
  return String(value)
}
/** 调用方传入同一事务，差异递归脱敏并保留日期语义。 */
export async function writeAudit(
  db: Prisma.TransactionClient | PrismaClient,
  event: {
    userId?: string
    action: string
    resource: string
    resourceId?: string
    before?: unknown
    after?: unknown
    ip?: string
    userAgent?: string
  },
) {
  return db.auditLog.create({
    data: {
      ...event,
      before: event.before === undefined ? undefined : safe(event.before),
      after: event.after === undefined ? undefined : safe(event.after),
    },
  })
}
