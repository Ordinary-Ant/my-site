import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MOTION_PRESETS, readMotionConfig, upgradeMotionV1 } from '@/config/motion'
import { requirePermission } from './auth'
import { writeAudit } from './audit'
import { invalidateConfiguration } from './cache'

export const MOTION_V1_BACKUP_KEY = 'motion.config.backup.v1'
const isV1 = (value: unknown) =>
  value !== null && typeof value === 'object' && 'version' in value && value.version === 1

/** 调用方持有配置事务锁，备份与升级审计和原配置原子提交。 */
export async function upgradeStoredMotion(tx: Prisma.TransactionClient) {
  const row = await tx.setting.findUnique({ where: { key: 'motion.config' } })
  if (!row || !isV1(row.value)) return readMotionConfig(row?.value)
  const config = upgradeMotionV1(row.value)
  await tx.setting.upsert({
    where: { key: MOTION_V1_BACKUP_KEY },
    create: {
      key: MOTION_V1_BACKUP_KEY,
      group: 'backup',
      value: row.value as Prisma.InputJsonValue,
    },
    update: {},
  })
  await tx.setting.update({ where: { key: row.key }, data: { value: config, updatedBy: null } })
  // 不提供userId表示系统升级，与可空审计actor合同一致。
  await writeAudit(tx, {
    resource: 'setting',
    resourceId: row.key,
    action: 'upgrade',
    before: row.value,
    after: config,
  })
  return config
}

/** 公开配置读取不需要后台权限；仅遇到旧值才进入持久化升级事务。 */
export async function readPersistedMotionConfig() {
  const row = await prisma.setting.findUnique({ where: { key: 'motion.config' } })
  if (!isV1(row?.value)) return readMotionConfig(row?.value)
  const config = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390232)`
    return upgradeStoredMotion(tx)
  })
  invalidateConfiguration()
  return config
}

export async function getAdminMotion(request?: Request) {
  await requirePermission('content:read', request)
  const config = await readPersistedMotionConfig()
  return {
    config,
    presets: MOTION_PRESETS,
    performance: {
      estimated: true,
      unit: 'KB gzip',
      motionBudget: 28,
      libraryExpected:
        config.preset !== 'static' && config.intensity !== 'off' && config.reveal.enabled,
      continuousAnimation: false,
      note: '仅根据配置估算是否需要编排库；实际gzip传输量需构建与网络测量。',
    },
  }
}
