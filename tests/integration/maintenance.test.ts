import { afterAll, expect, test } from 'vitest'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { clearExpiredRotationReplies, processMaintenance } from '@/lib/services/maintenance'
import { GET } from '@/app/api/v1/jobs/maintenance/route'
const id = `maintenance-${Date.now()}`
afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: id } })
  await prisma.user.deleteMany({ where: { id } })
  await prisma.viewReceipt.deleteMany({ where: { resource: id } })
  await prisma.previewToken.deleteMany({ where: { contentId: id } })
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: id } } })
  await prisma.$disconnect()
})
test('维护保留未过期旧RT重放凭据，只清除十秒后加密回复；阅读收据按最近成功日期清理', async () => {
  await prisma.user.create({
    data: { id, name: id, email: `${id}@example.com`, passwordHash: 'unused' },
  })
  const past = new Date(Date.now() - 60000),
    future = new Date(Date.now() + 600000)
  await prisma.session.createMany({
    data: [
      { id: `${id}-expired`, userId: id, refreshHash: `${id}-expired`, expiresAt: past },
      {
        id: `${id}-old`,
        userId: id,
        refreshHash: `${id}-old`,
        expiresAt: future,
        revokedAt: past,
        rotatedAt: past,
        rotationReply: 'encrypted-fixture',
      },
      {
        id: `${id}-grace`,
        userId: id,
        refreshHash: `${id}-grace`,
        expiresAt: future,
        revokedAt: new Date(),
        rotatedAt: new Date(),
        rotationReply: 'encrypted-fixture',
      },
    ],
  })
  await prisma.viewReceipt.createMany({
    data: [
      {
        resource: id,
        contentId: 'old',
        visitorHash: id,
        countedDate: past,
        windowExpiresAt: future,
        updatedAt: new Date(Date.now() - 31 * 86400000),
      },
      {
        resource: id,
        contentId: 'recent',
        visitorHash: id,
        countedDate: past,
        windowExpiresAt: past,
        updatedAt: past,
      },
    ],
  })
  await prisma.previewToken.create({
    data: { hash: id, kind: 'article', contentId: id, expiresAt: past },
  })
  await prisma.rateLimit.create({ data: { key: id, expiresAt: past } })
  await processMaintenance()
  expect(await prisma.session.findUnique({ where: { id: `${id}-expired` } })).toBeNull()
  expect(await prisma.session.findUnique({ where: { id: `${id}-old` } })).toMatchObject({
    refreshHash: `${id}-old`,
    rotationReply: null,
  })
  expect(await prisma.session.findUnique({ where: { id: `${id}-grace` } })).toMatchObject({
    rotationReply: 'encrypted-fixture',
  })
  expect(await prisma.viewReceipt.count({ where: { resource: id } })).toBe(1)
  expect(await prisma.viewReceipt.findFirst({ where: { resource: id } })).toMatchObject({
    contentId: 'recent',
  })
  expect(await prisma.previewToken.findUnique({ where: { hash: id } })).toBeNull()
  expect(await prisma.rateLimit.findUnique({ where: { key: id } })).toBeNull()
})
test('维护不接受Cookie或错误Bearer，未配置返回503且无凭据泄露', async () => {
  const saved = env.REVALIDATE_SECRET
  try {
    env.REVALIDATE_SECRET = 'maintenance-test-secret-at-least-32-characters'
    const response = await GET(
      new Request('http://localhost/api/v1/jobs/maintenance', {
        headers: { cookie: 'at=ignored' },
      }),
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    env.REVALIDATE_SECRET = undefined
    expect((await GET(new Request('http://localhost/api/v1/jobs/maintenance'))).status).toBe(503)
  } finally {
    env.REVALIDATE_SECRET = saved
  }
})

test('数据库事务冻结时间验证恰好十秒保留、超过一毫秒清空', async () => {
  await prisma.$transaction(async (tx) => {
    const [{ now }] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds', CURRENT_TIMESTAMP) AS now`
    const key = `${id}-boundary`
    await tx.session.create({
      data: {
        id: key,
        userId: id,
        refreshHash: key,
        expiresAt: new Date(now.getTime() + 60000),
        rotatedAt: new Date(now.getTime() - 10000),
        rotationReply: 'encrypted-fixture',
      },
    })
    await clearExpiredRotationReplies(tx)
    expect(await tx.session.findUnique({ where: { id: key } })).toMatchObject({
      rotationReply: 'encrypted-fixture',
    })
    await tx.session.update({
      where: { id: key },
      data: { rotatedAt: new Date(now.getTime() - 10001) },
    })
    await clearExpiredRotationReplies(tx)
    expect(await tx.session.findUnique({ where: { id: key } })).toMatchObject({
      rotationReply: null,
    })
  })
})
