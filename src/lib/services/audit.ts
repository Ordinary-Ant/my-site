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

export async function listAuditLogs(
  params: URLSearchParams = new URLSearchParams(),
  request?: Request,
) {
  const { requirePermission } = await import('./auth')
  const { prisma } = await import('@/lib/prisma')
  const { z } = await import('zod')
  await requirePermission('audit:read', request)
  const query = z
    .object({
      resource: z.string().max(80).optional(),
      action: z.string().max(80).optional(),
      userId: z.string().max(80).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .strict()
    .parse(Object.fromEntries(params))
  const { resource, action, userId, from, to, page, pageSize } = query
  const where: Prisma.AuditLogWhereInput = {
    resource,
    action,
    userId,
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  }
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])
  return {
    data: items.map((item) => ({
      ...item,
      before: safe(item.before),
      after: safe(item.after),
      createdAt: item.createdAt.toISOString(),
    })),
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
