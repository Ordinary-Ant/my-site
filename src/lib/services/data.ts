import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { can } from '@/lib/auth/rbac'
import { consumeRateLimit } from './rate-limit'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateConfiguration, invalidateContent } from './cache'
import {
  DATA_KEYS,
  ImportPreviewSchema,
  ImportSchema,
  rejectDangerousKeys,
  type DataBundle,
} from '@/lib/validators/data'
import { validateModuleRoute } from '@/lib/validators/module'
import { settingGroups, type SettingGroup } from '@/lib/validators/settings'

type Row = Record<string, unknown>
type Delegate = {
  findMany(args?: unknown): Promise<Row[]>
  create(args: { data: Row }): Promise<unknown>
  deleteMany(args?: unknown): Promise<unknown>
  upsert(args: unknown): Promise<unknown>
}
const names = {
  categories: 'category',
  tags: 'tag',
  articles: 'article',
  logs: 'log',
  projects: 'project',
  timelineItems: 'timelineItem',
  modules: 'module',
  settings: 'setting',
  profile: 'profile',
  routeAliases: 'routeAlias',
} as const
const contentKeys = ['categories', 'tags', 'articles', 'logs', 'projects', 'timelineItems'] as const
type Counts = Record<(typeof DATA_KEYS)[number], number>
const counts = (): Counts => Object.fromEntries(DATA_KEYS.map((k) => [k, 0])) as Counts
const dbDelegate = (tx: Prisma.TransactionClient, key: keyof typeof names) =>
  tx[names[key]] as unknown as Delegate
const conflict = () => new ApiError(409, 'IMPORT_CONFLICT', '数据或预览已变更，请重新预览')
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function checkLimit(bundle: unknown) {
  const b = bundle as DataBundle
  if (
    Buffer.byteLength(JSON.stringify(b)) > 4_000_000 ||
    DATA_KEYS.reduce(
      (n, k) => n + (k === 'profile' ? (b.data.profile ? 1 : 0) : b.data[k].length),
      0,
    ) > 5000
  )
    throw new ApiError(413, 'DATA_TOO_LARGE', '数据超过4MB或5000项，请使用数据库与媒体备份')
}
function preflight(body: unknown) {
  if (!rejectDangerousKeys(body))
    throw new ApiError(400, 'VALIDATION_ERROR', '数据结构过深、重复引用或包含危险键')
  if (body && typeof body === 'object' && 'bundle' in body) {
    const bundle = (body as { bundle: unknown }).bundle
    if (Buffer.byteLength(JSON.stringify(bundle) ?? '') > 4_000_000)
      throw new ApiError(413, 'DATA_TOO_LARGE', '数据超过4MB')
    if (bundle && typeof bundle === 'object' && 'data' in bundle) {
      const data = (bundle as { data: unknown }).data
      if (data && typeof data === 'object') {
        const entities = DATA_KEYS.reduce((total, key) => {
          const value = (data as Record<string, unknown>)[key]
          return total + (Array.isArray(value) ? value.length : key === 'profile' && value ? 1 : 0)
        }, 0)
        if (entities > 5000) throw new ApiError(413, 'DATA_TOO_LARGE', '数据超过5000项')
      }
    }
  }
}
async function snapshot(tx: Prisma.TransactionClient): Promise<DataBundle['data']> {
  const data: Row = {}
  for (const key of DATA_KEYS) {
    const rows = await dbDelegate(tx, key).findMany({
      orderBy: {
        [key === 'modules' || key === 'settings' ? 'key' : key === 'routeAliases' ? 'path' : 'id']:
          'asc',
      },
      ...(['articles', 'logs', 'projects'].includes(key)
        ? { include: { tags: { select: { id: true }, orderBy: { id: 'asc' } } } }
        : {}),
    })
    const included =
      key === 'settings'
        ? rows.filter(
            (r) =>
              Object.hasOwn(settingGroups, String(r.group)) &&
              Object.hasOwn(settingGroups[r.group as SettingGroup].shape, String(r.key)),
          )
        : rows
    data[key] =
      key === 'profile'
        ? (rows[0] ?? null)
        : included.map((row) => {
            const { tags, ...rest } = row
            if (['articles', 'logs', 'projects'].includes(key))
              return {
                ...rest,
                tagIds: (tags as { id: string }[]).map((t) => t.id),
                ...(key === 'logs'
                  ? { logDate: (row.logDate as Date).toISOString().slice(0, 10) }
                  : {}),
              }
            return row
          })
  }
  return JSON.parse(JSON.stringify(data)) as DataBundle['data']
}
async function lock(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390231)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390232)`
  // 固定表集合与顺序，阻止预览和导入期间的插入幻读及编辑竞争。
  await tx.$executeRaw`LOCK TABLE categories,tags,articles,logs,projects,timeline_items,profiles,modules,settings,route_aliases IN SHARE ROW EXCLUSIVE MODE`
}
async function active(tx: Prisma.TransactionClient, user: { id: string; sessionId: string }) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT u.id FROM users u JOIN sessions s ON s."userId"=u.id WHERE u.id=${user.id} AND u."isActive"=true AND u.role='ADMIN' AND s.id=${user.sessionId} AND s."revokedAt" IS NULL AND s."expiresAt">NOW() FOR SHARE OF u,s`
  if (!rows.length) throw new ApiError(401, 'UNAUTHORIZED', '请重新登录')
}
async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  try {
    return await prisma.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 60000,
      maxWait: 15000,
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === 'P2034' ||
        (e.code === 'P2010' && ['40001', '40P01'].includes(String(e.meta?.code))))
    )
      throw conflict()
    throw e
  }
}
export async function exportData(request?: Request): Promise<DataBundle> {
  const user = await requirePermission('content:read', request)
  if (!can(user.role, 'data:export')) throw new ApiError(403, 'FORBIDDEN', '没有操作权限')
  await consumeRateLimit(`adminwrite:${user.id}`, 120, 900000)
  const bundle = await transaction(async (tx) => {
    await lock(tx)
    await active(tx, user)
    return {
      version: '1.0' as const,
      exportedAt: new Date().toISOString(),
      data: await snapshot(tx),
    }
  })
  checkLimit(bundle)
  return bundle
}
type Report = {
  mode: 'merge' | 'replace'
  created: Counts
  skipped: Counts
  replaces: Counts
  mapped: Record<string, Array<{ from: string; to: string; reason: string }>>
  warnings: string[]
}
async function plan(
  tx: Prisma.TransactionClient,
  mode: 'merge' | 'replace',
  bundle: DataBundle,
  before: DataBundle['data'],
  actor: string,
) {
  const report: Report = {
    mode,
    created: counts(),
    skipped: counts(),
    replaces: counts(),
    mapped: {},
    warnings: [],
  }
  const planned: Record<string, Row[]> = {}
  const idMaps: Record<string, Map<string, string>> = {}
  const users = new Set((await tx.user.findMany({ select: { id: true } })).map((u) => u.id))
  for (const key of contentKeys) {
    const source = bundle.data[key] as unknown as Row[],
      existing = before[key] as unknown as Row[]
    const ids = new Set(existing.map((r) => String(r.id))),
      mapping = new Map<string, string>()
    idMaps[key] = mapping
    planned[key] = []
    report.replaces[key] = mode === 'replace' ? existing.length : 0
    for (const row of source) {
      const same =
        mode === 'merge'
          ? existing.find((e) =>
              key === 'categories' || key === 'tags' || key === 'articles' || key === 'projects'
                ? e.slug === row.slug
                : e.id === row.id,
            )
          : undefined
      if (same) {
        mapping.set(String(row.id), String(same.id))
        report.skipped[key]++
        if (key === 'categories' || key === 'tags')
          (report.mapped[key] ??= []).push({
            from: String(row.id),
            to: String(same.id),
            reason: 'slug复用',
          })
        continue
      }
      let id = String(row.id)
      if (mode === 'merge' && ids.has(id)) {
        id = 'c' + digest([key, row.id, digest(before)]).slice(0, 24)
        ;(report.mapped[key] ??= []).push({ from: String(row.id), to: id, reason: 'ID冲突' })
      }
      ids.add(id)
      mapping.set(String(row.id), id)
      const prior = existing.find((e) => e.id === row.id)
      const next = {
        ...row,
        id,
        revision:
          mode === 'replace'
            ? Math.max(Number(prior?.revision ?? 0), Number(row.revision)) + 1
            : row.revision,
      }
      if ('authorId' in next && next.authorId && !users.has(String(next.authorId))) {
        next.authorId = actor
        report.warnings.push(`${key}:${row.id} 作者不存在，映射当前管理员`)
      }
      planned[key].push(next)
      report.created[key]++
    }
  }
  for (const c of planned.categories)
    if (c.parentId) c.parentId = idMaps.categories.get(String(c.parentId))
  for (const key of ['articles', 'logs', 'projects'])
    for (const row of planned[key]) {
      row.tagIds = (row.tagIds as string[]).map((t) => idMaps.tags.get(t)!)
      if (row.categoryId) row.categoryId = idMaps.categories.get(String(row.categoryId))
    }
  // 合并后的分类仍须满足两层限制，不能通过复用现有子分类产生第三层。
  const finalCats = [...(mode === 'merge' ? before.categories : []), ...planned.categories]
  const catMap = new Map(finalCats.map((c) => [String(c.id), c]))
  if (
    finalCats.some(
      (c) =>
        c.parentId && (!catMap.has(String(c.parentId)) || catMap.get(String(c.parentId))?.parentId),
    )
  )
    throw new ApiError(400, 'VALIDATION_ERROR', '合并后的分类超过两层')
  for (const key of ['modules', 'settings', 'profile'] as const) {
    report.created[key] =
      mode === 'replace'
        ? key === 'profile'
          ? bundle.data.profile
            ? 1
            : 0
          : bundle.data[key].length
        : 0
    report.skipped[key] =
      mode === 'merge'
        ? key === 'profile'
          ? bundle.data.profile
            ? 1
            : 0
          : bundle.data[key].length
        : 0
    report.replaces[key] =
      mode === 'replace' ? (key === 'profile' ? (before.profile ? 1 : 0) : before[key].length) : 0
  }
  if (mode === 'merge') report.warnings.push('已有模块、设置和个人档案配置保留，不覆盖')
  const modules = mode === 'replace' ? bundle.data.modules : before.modules
  const aliases = new Map(before.routeAliases.map((a) => [a.path, a]))
  if (mode === 'replace') {
    for (const old of before.modules)
      if (modules.find((m) => m.key === old.key)?.route !== old.route)
        aliases.set(old.route, {
          path: old.route,
          moduleKey: old.key,
          createdAt: new Date().toISOString(),
        })
  }
  for (const a of bundle.data.routeAliases) {
    const old = aliases.get(a.path)
    if (old && old.moduleKey !== a.moduleKey)
      throw new ApiError(409, 'ROUTE_CONFLICT', '不能抢占历史路径')
    aliases.set(a.path, old ?? a)
  }
  for (const m of modules) {
    const a = aliases.get(m.route)
    if (a) {
      if (a.moduleKey !== m.key) throw new ApiError(409, 'ROUTE_CONFLICT', '不能抢占历史路径')
      aliases.delete(m.route)
    }
  }
  try {
    for (const m of modules) validateModuleRoute(m.key, m.route, modules, [...aliases.values()])
    for (const a of aliases.values())
      validateModuleRoute(
        a.moduleKey,
        a.path,
        modules,
        [...aliases.values()].filter((v) => v.path !== a.path),
      )
  } catch {
    throw new ApiError(409, 'ROUTE_CONFLICT', '最终模块与历史路径冲突')
  }
  planned.routeAliases = [...aliases.values()]
  report.created.routeAliases = planned.routeAliases.filter(
    (a) => !before.routeAliases.some((b) => b.path === a.path),
  ).length
  report.skipped.routeAliases = before.routeAliases.length
  return { report, planned }
}
const signature = (payload: string) =>
  createHmac('sha256', env.JWT_SECRET)
    .update('data-import-preview:v1:' + payload)
    .digest('base64url')
function verify(token: string, expected: Row) {
  try {
    const [payload, sig, ...extra] = token.split('.')
    if (extra.length || !payload || !sig) throw Error()
    const wanted = Buffer.from(signature(payload)),
      got = Buffer.from(sig)
    if (wanted.length !== got.length || !timingSafeEqual(wanted, got)) throw Error()
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (parsed.exp <= Date.now() || Object.entries(expected).some(([k, v]) => parsed[k] !== v))
      throw Error()
  } catch {
    throw conflict()
  }
}
export async function previewImport(body: unknown, request?: Request) {
  const user = await requirePermission('data:import', request)
  preflight(body)
  const input = ImportPreviewSchema.parse(body)
  checkLimit(input.bundle)
  return transaction(async (tx) => {
    await lock(tx)
    await active(tx, user)
    const before = await snapshot(tx)
    const { report } = await plan(tx, input.mode, input.bundle, before, user.id)
    const exp = Date.now() + 600000
    const payload = Buffer.from(
      JSON.stringify({
        actor: user.id,
        sid: user.sessionId,
        mode: input.mode,
        bundle: digest(input.bundle),
        snapshot: digest(before),
        exp,
      }),
    ).toString('base64url')
    return {
      ...report,
      token: payload + '.' + signature(payload),
      expiresAt: new Date(exp).toISOString(),
    }
  })
}
function storage(row: Row): Row {
  const { tagIds, ...data } = row
  for (const key of [
    'createdAt',
    'updatedAt',
    'deletedAt',
    'publishedAt',
    'startDate',
    'endDate',
    'birthday',
  ])
    if (typeof data[key] === 'string') data[key] = new Date(data[key] as string)
  if (typeof data.logDate === 'string') data.logDate = new Date(data.logDate + 'T00:00:00Z')
  for (const key of ['links', 'config', 'value', 'socials', 'advantages', 'skills', 'services'])
    if (key in data && data[key] === null) data[key] = Prisma.JsonNull
  if (tagIds) data.tags = { connect: (tagIds as string[]).map((id) => ({ id })) }
  return data
}
export async function importData(body: unknown, request?: Request) {
  const user = await requirePermission('data:import', request)
  preflight(body)
  const input = ImportSchema.parse(body)
  checkLimit(input.bundle)
  const result = await transaction(async (tx) => {
    await lock(tx)
    await active(tx, user)
    const before = await snapshot(tx)
    verify(input.token, {
      actor: user.id,
      sid: user.sessionId,
      mode: input.mode,
      bundle: digest(input.bundle),
      snapshot: digest(before),
    })
    const { report, planned } = await plan(tx, input.mode, input.bundle, before, user.id)
    if (input.mode === 'replace') {
      for (const [key, kind] of [
        ['articles', 'article'],
        ['logs', 'log'],
        ['projects', 'project'],
        ['timelineItems', 'timeline'],
      ] as const)
        await tx.previewToken.deleteMany({
          where: { kind, contentId: { in: before[key].map((r) => r.id) } },
        })
      for (const key of [
        'articles',
        'logs',
        'projects',
        'timelineItems',
        'categories',
        'tags',
      ] as const)
        await dbDelegate(tx, key).deleteMany()
    }
    for (const key of contentKeys) {
      const rows =
        key === 'categories'
          ? [...planned[key]].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId))
          : planned[key]
      for (const row of rows) await dbDelegate(tx, key).create({ data: storage(row) })
    }
    if (input.mode === 'replace') {
      // 移除唯一索引暂态冲突；所有别名在同一事务恢复。
      await tx.routeAlias.deleteMany()
      await tx.module.deleteMany()
      for (const row of input.bundle.data.modules)
        await dbDelegate(tx, 'modules').create({ data: storage(row) })
      await tx.setting.deleteMany({ where: { key: { in: before.settings.map((s) => s.key) } } })
      for (const row of input.bundle.data.settings)
        await dbDelegate(tx, 'settings').create({ data: storage(row) })
      await tx.profile.deleteMany()
      if (input.bundle.data.profile)
        await dbDelegate(tx, 'profile').create({
          data: storage({
            ...input.bundle.data.profile,
            revision:
              Math.max(before.profile?.revision ?? 0, input.bundle.data.profile.revision) + 1,
          }),
        })
      for (const row of planned.routeAliases)
        await dbDelegate(tx, 'routeAliases').create({ data: storage(row) })
    } else {
      await tx.routeAlias.deleteMany({
        where: {
          path: {
            in: before.routeAliases
              .filter((a) => !planned.routeAliases.some((p) => p.path === a.path))
              .map((a) => a.path),
          },
        },
      })
      for (const row of planned.routeAliases)
        if (!before.routeAliases.some((a) => a.path === row.path))
          await dbDelegate(tx, 'routeAliases').create({ data: storage(row) })
    }
    await writeAudit(tx, {
      userId: user.id,
      action: 'import',
      resource: 'data',
      after: {
        mode: input.mode,
        digest: digest(input.bundle),
        created: report.created,
        skipped: report.skipped,
        replaces: report.replaces,
      },
    })
    return report
  })
  invalidateConfiguration()
  for (const k of ['article', 'log', 'project', 'timeline', 'profile', 'category', 'tag'])
    invalidateContent(k)
  return result
}
