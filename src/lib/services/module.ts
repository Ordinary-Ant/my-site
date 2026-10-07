import 'server-only'
import { z } from 'zod'
import type { Prisma, Module } from '@prisma/client'
import { MODULE_KEYS, type ModuleKey } from '@/config/modules'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import { mergeModuleConfig, validateModuleRoute } from '@/lib/validators/module'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateConfiguration } from './cache'
const keySchema = z.enum(MODULE_KEYS)
const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    navVisible: z.boolean().optional(),
    navLabel: z.string().max(40).nullable().optional(),
    name: z.string().min(1).max(40).optional(),
    description: z.string().max(1000).nullable().optional(),
    icon: z.string().max(80).nullable().optional(),
    route: z.string().optional(),
    navOrder: z.number().int().min(0).max(100).optional(),
    config: z.record(z.unknown()).optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
const orderItem = z
  .object({
    key: keySchema,
    navOrder: z.number().int().min(0).max(100),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
const conflict = () => new ApiError(409, 'CONFIG_CONFLICT', '配置已变更，请刷新后重试')
async function lock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390231)`
}
function cas(module: Module, expected?: string) {
  if (expected && module.updatedAt.getTime() !== new Date(expected).getTime()) throw conflict()
}
async function stats(key: string) {
  const live = { deletedAt: null }
  if (key === 'article' || key === 'log' || key === 'portfolio') {
    const counts =
      key === 'article'
        ? await prisma.article.groupBy({ by: ['status'], where: live, _count: true })
        : key === 'log'
          ? await prisma.log.groupBy({ by: ['status'], where: live, _count: true })
          : await prisma.project.groupBy({ by: ['status'], where: live, _count: true })
    return {
      totalItems: counts.reduce((n, c) => n + c._count, 0),
      publishedItems: counts.find((c) => c.status === 'PUBLISHED')?._count ?? 0,
      draftItems: counts.find((c) => c.status === 'DRAFT')?._count ?? 0,
    }
  }
  if (key === 'timeline') {
    const total = await prisma.timelineItem.count({ where: live })
    const visible = await prisma.timelineItem.count({ where: { ...live, visible: true } })
    return { totalItems: total, publishedItems: visible, draftItems: total - visible }
  }
  if (key === 'about') {
    const total = await prisma.profile.count()
    return { totalItems: total, publishedItems: total, draftItems: 0 }
  }
  return { totalItems: 0, publishedItems: 0, draftItems: 0 }
}
async function dto(module: Module) {
  return {
    ...module,
    config: mergeModuleConfig(module.key as ModuleKey, module.config, {}),
    updatedAt: module.updatedAt.toISOString(),
    aliases: await prisma.routeAlias.findMany({
      where: { moduleKey: module.key },
      select: { path: true },
    }),
    stats: await stats(module.key),
  }
}
export async function listAdminModules(request?: Request) {
  await requirePermission('content:read', request)
  return Promise.all(
    (await prisma.module.findMany({ orderBy: [{ navOrder: 'asc' }, { key: 'asc' }] })).map(dto),
  )
}
async function response(module: Module, audit?: { id: string; createdAt: Date }) {
  const result = await dto(module)
  return {
    module: result,
    effects: {
      routesDisabled: module.enabled ? [] : [module.route, `${module.route}/[id]`],
      navRemoved: !module.enabled || !module.navVisible,
      sitemapUpdated: true,
      cacheInvalidated: ['module', 'content', 'home'],
      affectedItems: result.stats.totalItems,
      warning: module.enabled
        ? null
        : `该模块有 ${result.stats.totalItems} 条内容，关闭后前台将不可访问，但数据会完整保留。`,
    },
    ...(audit
      ? {
          undo: {
            auditId: audit.id,
            expiresAt: new Date(audit.createdAt.getTime() + 5000).toISOString(),
          },
        }
      : {}),
  }
}
export async function updateModule(key: string, body: unknown, request?: Request) {
  keySchema.parse(key)
  const user = await requirePermission('module:write', request)
  const patch = patchSchema.parse(body)
  if (key === 'home' && (patch.enabled === false || (patch.route && patch.route !== '/')))
    throw new ApiError(400, 'VALIDATION_ERROR', '首页不可关闭或修改路径')
  const result = await prisma.$transaction(async (tx) => {
    await lock(tx)
    const before = await tx.module.findUniqueOrThrow({ where: { key } })
    cas(before, patch.expectedUpdatedAt)
    const { expectedUpdatedAt: _, config, ...data } = patch
    void _
    if (data.route && data.route !== before.route) {
      try {
        validateModuleRoute(
          key,
          data.route,
          await tx.module.findMany(),
          await tx.routeAlias.findMany(),
        )
      } catch {
        throw new ApiError(409, 'ROUTE_CONFLICT', '路径与系统、栏目或历史地址冲突')
      }
      await tx.routeAlias.upsert({
        where: { path: before.route },
        create: { path: before.route, moduleKey: key },
        update: {},
      })
    }
    let merged
    try {
      merged =
        config === undefined
          ? undefined
          : mergeModuleConfig(key as ModuleKey, before.config, config)
    } catch (error) {
      if (error instanceof z.ZodError) throw error
      throw new ApiError(400, 'VALIDATION_ERROR', '配置格式不正确')
    }
    const updated = await tx.module.update({
      where: { key },
      data: {
        ...data,
        ...(merged !== undefined ? { config: merged as Prisma.InputJsonValue } : {}),
      },
    })
    const toggle = before.enabled !== updated.enabled
    const audit = await writeAudit(tx, {
      userId: user.id,
      resource: 'module',
      resourceId: key,
      action: toggle ? 'toggle' : 'update',
      before,
      after: updated,
    })
    return { module: updated, audit: toggle ? audit : undefined }
  })
  invalidateConfiguration()
  return response(result.module, result.audit)
}
export async function reorderModules(body: unknown, request?: Request) {
  const user = await requirePermission('module:write', request)
  const { items } = z
    .object({ items: z.array(orderItem).min(1).max(6) })
    .strict()
    .parse(body)
  if (
    new Set(items.map((i) => i.key)).size !== items.length ||
    new Set(items.map((i) => i.navOrder)).size !== items.length
  )
    throw new ApiError(400, 'VALIDATION_ERROR', '排序包含重复栏目或顺序')
  await prisma.$transaction(async (tx) => {
    await lock(tx)
    for (const item of items) {
      const before = await tx.module.findUniqueOrThrow({ where: { key: item.key } })
      cas(before, item.expectedUpdatedAt)
      const after = await tx.module.update({
        where: { key: item.key },
        data: { navOrder: item.navOrder },
      })
      await writeAudit(tx, {
        userId: user.id,
        resource: 'module',
        resourceId: item.key,
        action: 'reorder',
        before,
        after,
      })
    }
  })
  invalidateConfiguration()
  return listAdminModules(request)
}
export async function undoModule(key: string, body: unknown, request?: Request) {
  keySchema.parse(key)
  const user = await requirePermission('module:write', request)
  const { auditId } = z
    .object({ auditId: z.string().min(1) })
    .strict()
    .parse(body)
  const restoredModule = await prisma.$transaction(async (tx) => {
    await lock(tx)
    const audit = await tx.auditLog.findUnique({ where: { id: auditId } })
    const current = await tx.module.findUniqueOrThrow({ where: { key } })
    if (
      !audit ||
      audit.resource !== 'module' ||
      audit.resourceId !== key ||
      audit.action !== 'toggle' ||
      Date.now() > audit.createdAt.getTime() + 5000
    )
      throw conflict()
    const before = audit.before as { enabled: boolean }
    const after = audit.after as { enabled: boolean; updatedAt: string }
    if (current.enabled !== after.enabled || current.updatedAt.toISOString() !== after.updatedAt)
      throw conflict()
    const restored = await tx.module.update({ where: { key }, data: { enabled: before.enabled } })
    await writeAudit(tx, {
      userId: user.id,
      resource: 'module',
      resourceId: key,
      action: 'undo',
      before: current,
      after: restored,
    })
    return restored
  })
  invalidateConfiguration()
  return response(restoredModule)
}
