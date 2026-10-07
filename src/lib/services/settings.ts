import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import { settingGroups, type SettingGroup } from '@/lib/validators/settings'
import { mergeKnownObjects } from '@/lib/validators/module'
import { DEFAULT_MOTION, motionSchema } from '@/config/motion'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateConfiguration } from './cache'
export async function readKnownSettings() {
  const rows = await prisma.setting.findMany({
    where: { group: { in: Object.keys(settingGroups) } },
  })
  const grouped: Record<string, Record<string, unknown>> = {}
  for (const row of rows) {
    const group = row.group as SettingGroup
    if (!Object.hasOwn(settingGroups[group].shape, row.key)) continue
    ;(grouped[group] ??= {})[row.key] = row.value
  }
  return grouped
}
export async function listSettings(request?: Request) {
  await requirePermission('content:read', request)
  return readKnownSettings()
}
export async function updateSettings(group: string, body: unknown, request?: Request) {
  const user = await requirePermission('setting:write', request)
  if (!Object.hasOwn(settingGroups, group))
    throw new ApiError(400, 'VALIDATION_ERROR', '未知设置组')
  const patch = settingGroups[group as SettingGroup].parse(body)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390232)`
    for (const [key, value] of Object.entries(patch)) {
      const before = await tx.setting.findUnique({ where: { key } })
      let next = value
      if (key === 'motion.config') {
        try {
          next = motionSchema.parse(mergeKnownObjects(before?.value ?? DEFAULT_MOTION, value))
        } catch {
          throw new ApiError(400, 'VALIDATION_ERROR', '动效配置格式不正确')
        }
      }
      const after = await tx.setting.upsert({
        where: { key },
        create: {
          key,
          group,
          value: next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue),
          updatedBy: user.id,
        },
        update: {
          value: next === null ? Prisma.JsonNull : (next as Prisma.InputJsonValue),
          updatedBy: user.id,
        },
      })
      await writeAudit(tx, {
        userId: user.id,
        resource: 'setting',
        resourceId: key,
        action: 'update',
        before: before?.value,
        after: after.value,
      })
    }
  })
  invalidateConfiguration()
  return (await readKnownSettings())[group] ?? {}
}
