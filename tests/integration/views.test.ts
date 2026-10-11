import { beforeAll, afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { countPublicView, recordPublicView, getAdminStats } from '@/lib/services/stats'
import { login } from '@/lib/services/auth'
import bcrypt from 'bcryptjs'
const run = 'views-' + randomUUID(),
  visitor = 'a'.repeat(64)
let id = '',
  column: Awaited<ReturnType<typeof prisma.module.findUniqueOrThrow>>,
  updatedAt: Date
beforeAll(async () => {
  expect(
    (await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
  ).toMatch(/_test$/)
  column = await prisma.module.findUniqueOrThrow({ where: { key: 'article' } })
  await prisma.module.update({ where: { key: 'article' }, data: { enabled: true } })
  const item = await prisma.article.create({
    data: {
      slug: run,
      title: run,
      content: '正文',
      status: 'PUBLISHED',
      publishedAt: new Date('2020-01-01'),
    },
  })
  id = item.id
  updatedAt = item.updatedAt
})
afterAll(async () => {
  if (id) {
    await prisma.viewReceipt.deleteMany({ where: { contentId: id } })
    await prisma.dailyStat.deleteMany({ where: { contentId: id } })
    await prisma.article.deleteMany({ where: { id } })
  }
  if (column)
    await prisma.module.update({
      where: { key: 'article' },
      data: {
        enabled: column.enabled,
        route: column.route,
        config: column.config === null ? Prisma.JsonNull : column.config,
      },
    })
  await prisma.$disconnect()
})
test('首次并发同访客严格计一次，计数不改revision或更新时间', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => countPublicView('article', id, visitor)),
  )
  expect(results.filter((r) => r.counted)).toHaveLength(1)
  const item = await prisma.article.findUniqueOrThrow({ where: { id } })
  expect(item.viewCount).toBe(1)
  expect(item.revision).toBe(1)
  expect(item.updatedAt).toEqual(updatedAt)
  const stat = await prisma.dailyStat.findFirstOrThrow({ where: { contentId: id } })
  expect(stat.views).toBe(1)
  expect(stat.uniques).toBe(1)
})
test('同日超窗PV增加而UV不重复；跨午夜窗口仍去重', async () => {
  const key = { resource: 'article', contentId: id, visitorHash: visitor }
  const original = await prisma.viewReceipt.findUniqueOrThrow({
    where: { resource_contentId_visitorHash: key },
  })
  expect((await countPublicView('article', id, visitor)).counted).toBe(false)
  expect(
    (await prisma.viewReceipt.findUniqueOrThrow({ where: { resource_contentId_visitorHash: key } }))
      .updatedAt,
  ).toEqual(original.updatedAt)
  await prisma.viewReceipt.update({
    where: { resource_contentId_visitorHash: key },
    data: { windowExpiresAt: new Date('2000-01-01') },
  })
  const results = await Promise.all(
    Array.from({ length: 5 }, () => countPublicView('article', id, visitor)),
  )
  expect(results.filter((r) => r.counted)).toHaveLength(1)
  expect((await prisma.dailyStat.findFirstOrThrow({ where: { contentId: id } })).uniques).toBe(1)
  await prisma.viewReceipt.update({
    where: { resource_contentId_visitorHash: key },
    data: { countedDate: new Date('2000-01-01') },
  })
  expect((await countPublicView('article', id, visitor)).counted).toBe(false)
  await prisma.viewReceipt.update({
    where: { resource_contentId_visitorHash: key },
    data: { windowExpiresAt: new Date('2000-01-01') },
  })
  expect((await countPublicView('article', id, visitor)).counted).toBe(true)
  expect((await prisma.dailyStat.findFirstOrThrow({ where: { contentId: id } })).uniques).toBe(2)
})
test('路径变更保留同资源去重，公开状态关闭后不可继续计数', async () => {
  await prisma.module.update({ where: { key: 'article' }, data: { route: '/' + run } })
  expect((await countPublicView('article', id, visitor)).counted).toBe(false)
  expect((await countPublicView('article', id, 'b'.repeat(64))).counted).toBe(true)
  const stats = await prisma.dailyStat.findMany({ where: { contentId: id } })
  expect(stats).toHaveLength(1)
  expect(stats[0].path).toBe('/' + run + '/' + run)
  await prisma.module.update({ where: { key: 'article' }, data: { enabled: false } })
  await expect(countPublicView('article', id, 'c'.repeat(64))).rejects.toMatchObject({
    status: 404,
  })
  await prisma.module.update({ where: { key: 'article' }, data: { enabled: true } })
})
test('内容计数失败整体回滚receipt与每日统计', async () => {
  await prisma.$executeRaw`UPDATE articles SET "viewCount"=2147483647 WHERE id=${id}`
  const before = await prisma.dailyStat.findFirstOrThrow({ where: { contentId: id } })
  await expect(countPublicView('article', id, 'd'.repeat(64))).rejects.toThrow()
  expect(
    await prisma.viewReceipt.count({ where: { contentId: id, visitorHash: 'd'.repeat(64) } }),
  ).toBe(0)
  expect((await prisma.dailyStat.findFirstOrThrow({ where: { contentId: id } })).views).toBe(
    before.views,
  )
  await prisma.$executeRaw`UPDATE articles SET "viewCount"=0 WHERE id=${id}`
})

test('上报Origin/严格字段/签名cookie/DNT及三角色统计权限', async () => {
  const request = (cookie = '', origin = process.env.NEXT_PUBLIC_SITE_URL!, dnt = false) =>
    new Request('http://localhost/api/v1/views', {
      method: 'POST',
      headers: { origin, cookie, 'user-agent': 'Mozilla/5.0', ...(dnt ? { dnt: '1' } : {}) },
    })
  await expect(
    recordPublicView({ resource: 'article', id }, request('', 'https://evil.test')),
  ).rejects.toMatchObject({ status: 403 })
  await expect(
    recordPublicView({ resource: 'article', id, count: 9000 }, request()),
  ).rejects.toThrow()
  const first = await recordPublicView({ resource: 'article', id }, request())
  expect(first.data.counted).toBe(true)
  expect(first.cookie).toBeTruthy()
  const cookie = 'site_visitor=' + first.cookie
  expect((await recordPublicView({ resource: 'article', id }, request(cookie))).data.counted).toBe(
    false,
  )
  expect(
    (await recordPublicView({ resource: 'article', id }, request(cookie, undefined, true))).data
      .viewCount,
  ).toBeNull()
  const userIds: string[] = []
  try {
    for (const role of ['ADMIN', 'EDITOR', 'VIEWER'] as const) {
      const u = await prisma.user.create({
        data: {
          email: run + '-' + role.toLowerCase() + '@example.com',
          name: role,
          role,
          passwordHash: await bcrypt.hash('StatsPass123', 4),
        },
      })
      userIds.push(u.id)
      const token = (await login(u.email, 'StatsPass123', { ip: run }, request())).accessToken
      const authRequest = new Request('http://localhost/api/v1/admin/stats', {
        headers: { authorization: 'Bearer ' + token },
      })
      const stats = await getAdminStats(authRequest)
      expect(stats.counts.articles.total).toBe(
        await prisma.article.count({ where: { deletedAt: null } }),
      )
      expect(stats.traffic).toHaveLength(7)
      expect(stats.system.lastBackupAt).toBeNull()
      expect(stats.recent.viewsLast7Days).toBeGreaterThan(0)
      await prisma.session.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } })
      await expect(getAdminStats(authRequest)).rejects.toMatchObject({ status: 401 })
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.rateLimit.deleteMany({ where: { OR: [{ key: { contains: run } }] } })
  }
})
