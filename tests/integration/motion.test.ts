import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Setting } from '@prisma/client'
import bcrypt from 'bcryptjs'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { DEFAULT_MOTION } from '@/config/motion'
import { login } from '@/lib/services/auth'
import {
  getAdminMotion,
  MOTION_V1_BACKUP_KEY,
  readPersistedMotionConfig,
} from '@/lib/services/motion'
import { readKnownSettings, updateSettings } from '@/lib/services/settings'
import { getPublicSite } from '@/lib/services/public-site'
import { GET, PATCH } from '@/app/api/v1/admin/settings/[group]/route'

let token: string, userId: string
let original: Setting | null, backup: Setting | null
const started = new Date()
const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
const context = { params: Promise.resolve({ group: 'motion' }) }
const req = (method = 'GET', body?: unknown) =>
  new Request(`${origin}/api/v1/admin/settings/motion`, {
    method,
    headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const legacy = {
  version: 1,
  preset: 'minimal',
  respectReducedMotion: false,
  background: { type: 'aurora' },
  cursor: { enabled: true },
  reveal: { duration: 3000, stagger: 500 },
}
async function store(value: object) {
  await prisma.setting.upsert({
    where: { key: 'motion.config' },
    create: { key: 'motion.config', group: 'motion', value },
    update: { group: 'motion', value },
  })
}
beforeAll(async () => {
  original = await prisma.setting.findUnique({ where: { key: 'motion.config' } })
  backup = await prisma.setting.findUnique({ where: { key: MOTION_V1_BACKUP_KEY } })
  const user = await prisma.user.create({
    data: {
      name: '动效验收',
      email: `motion-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('MotionPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'MotionPass123', { ip: user.id }, req('POST'))).accessToken
})
beforeEach(async () => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: true } })
  await store(DEFAULT_MOTION)
  vi.mocked(revalidateTag).mockClear()
})
afterAll(async () => {
  await prisma.setting.deleteMany({
    where: { key: { in: ['motion.config', MOTION_V1_BACKUP_KEY] } },
  })
  for (const row of [original, backup])
    if (row) await prisma.setting.create({ data: { ...row, value: row.value! } })
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { userId },
        {
          action: 'upgrade',
          resource: 'setting',
          resourceId: 'motion.config',
          createdAt: { gte: started },
        },
      ],
    },
  })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.rateLimit.deleteMany({ where: { key: { contains: userId } } })
  await prisma.$disconnect()
})

test('真实PG并发读取v1只升级一次，原值完整备份且系统审计不丢失', async () => {
  await prisma.setting.deleteMany({ where: { key: MOTION_V1_BACKUP_KEY } })
  await store(legacy)
  const count = await prisma.auditLog.count({
    where: { resourceId: 'motion.config', action: 'upgrade' },
  })
  const configs = await Promise.all(Array.from({ length: 8 }, () => readPersistedMotionConfig()))
  for (const config of configs)
    expect(config).toMatchObject({
      version: 2,
      preset: 'static',
      respectReducedMotion: true,
      reveal: { duration: 800, stagger: 100 },
    })
  expect(
    (await prisma.setting.findUniqueOrThrow({ where: { key: MOTION_V1_BACKUP_KEY } })).value,
  ).toEqual(legacy)
  expect(
    await prisma.auditLog.count({ where: { resourceId: 'motion.config', action: 'upgrade' } }),
  ).toBe(count + 1)
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { resourceId: 'motion.config', action: 'upgrade' },
    orderBy: { createdAt: 'desc' },
  })
  expect(audit.userId).toBeNull()
  expect(audit.before).toEqual(legacy)
  expect(audit.after).toEqual(configs[0])
  expect(JSON.stringify(await readKnownSettings())).not.toContain('backup')
  expect(JSON.stringify(await getPublicSite())).not.toContain('aurora')
})

test('GET返回配置四预设和明确估算；权限使用数据库当前角色和启用状态', async () => {
  const response = await GET(req(), context)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const { data } = await response.json()
  expect(data.config).toEqual(DEFAULT_MOTION)
  expect(Object.keys(data.presets)).toHaveLength(4)
  expect(data.performance).toMatchObject({ estimated: true, motionBudget: 28 })
  await prisma.user.update({ where: { id: userId }, data: { role: 'EDITOR' } })
  expect((await GET(req(), context)).status).toBe(200)
  expect(
    (await PATCH(req('PATCH', { 'motion.config': { intensity: 'off' } }), context)).status,
  ).toBe(403)
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  expect(
    (await PATCH(req('PATCH', { 'motion.config': { intensity: 'off' } }), context)).status,
  ).toBe(403)
  await prisma.user.update({ where: { id: userId }, data: { isActive: false } })
  await expect(getAdminMotion(req())).rejects.toMatchObject({ status: 401 })
})

test('PATCH保留键对象合同，深合并、审计并失效公开关联缓存', async () => {
  const response = await PATCH(
    req('PATCH', { 'motion.config': { reveal: { duration: 600 }, decoration: { type: 'tint' } } }),
    context,
  )
  expect(response.status).toBe(200)
  expect((await response.json()).data).toEqual({
    'motion.config': {
      ...DEFAULT_MOTION,
      reveal: { ...DEFAULT_MOTION.reveal, duration: 600 },
      decoration: { ...DEFAULT_MOTION.decoration, type: 'tint' },
    },
  })
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { userId, action: 'update', resourceId: 'motion.config' },
    orderBy: { createdAt: 'desc' },
  })
  expect(audit.before).toEqual(DEFAULT_MOTION)
  expect(audit.after).toMatchObject({ reveal: { duration: 600 } })
  expect(vi.mocked(revalidateTag).mock.calls.flat()).toEqual(
    expect.arrayContaining(['setting', 'content', 'home']),
  )
})

test('PATCH强制reduce为422，其余未知危险键、null、数组和非法值为400且不写库', async () => {
  const patches = [
    { respectReducedMotion: false },
    { unknown: true },
    { reveal: { unknown: true } },
    { decoration: null },
    { reveal: [] },
    { intensity: 'heavy' },
    { respectReducedMotion: 'false' },
    { version: 1 },
    { reveal: { duration: 149 } },
    JSON.parse('{"reveal":{"__proto__":{"polluted":true}}}'),
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ]
  for (const patch of patches) {
    const response = await PATCH(req('PATCH', { 'motion.config': patch }), context)
    expect(response.status).toBe(patch.respectReducedMotion === false ? 422 : 400)
  }
  expect(
    (await prisma.setting.findUniqueOrThrow({ where: { key: 'motion.config' } })).value,
  ).toEqual(DEFAULT_MOTION)
})

test('PATCH旧配置在同一事务升级并保留升级后未修改字段', async () => {
  await store({ ...legacy, preset: 'aurora', autoDegrade: false })
  const saved = await updateSettings(
    'motion',
    { 'motion.config': { reveal: { enabled: false } } },
    req('PATCH'),
  )
  expect(saved['motion.config']).toMatchObject({
    version: 2,
    preset: 'editorial',
    autoDegrade: false,
    reveal: { enabled: false, duration: 800, stagger: 100 },
  })
  expect(JSON.stringify(saved)).not.toContain('cursor')
})

test('公开首次读取v1也安全升级，损坏v2安全回退不泄露旧字段', async () => {
  await store(legacy)
  expect((await getPublicSite()).motion).toMatchObject({ version: 2, preset: 'static' })
  await store({ ...DEFAULT_MOTION, secretLegacyField: 'private-old' })
  expect((await getPublicSite()).motion).toEqual(DEFAULT_MOTION)
})

test('已撤销AT会话的读取与写入均拒绝', async () => {
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
  expect((await GET(req(), context)).status).toBe(401)
  expect(
    (await PATCH(req('PATCH', { 'motion.config': { intensity: 'off' } }), context)).status,
  ).toBe(401)
})
