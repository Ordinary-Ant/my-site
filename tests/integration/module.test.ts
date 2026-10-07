import { beforeAll, afterAll, test, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import * as modules from '@/lib/services/module'
let token: string, userId: string
const req = (method = 'PATCH') =>
  new Request('http://localhost:3000/api/v1/admin/modules', {
    method,
    headers: { origin: 'http://localhost:3000', authorization: `Bearer ${token}` },
  })
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: '模块验收',
      email: `module-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: user.id }, req('POST'))).accessToken
})
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('配置服务存在且保护首页、未知字段与CAS', async () => {
  expect(modules.updateModule).toBeTypeOf('function')
  const home = (await modules.listAdminModules(req('GET'))).find((m) => m.key === 'home')!
  await expect(modules.updateModule('home', { enabled: false }, req())).rejects.toMatchObject({
    status: 400,
  })
  await expect(
    modules.updateModule(
      'home',
      { expectedUpdatedAt: '2000-01-01T00:00:00Z', name: home.name },
      req(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  await expect(modules.updateModule('home', { config: { unknown: true } }, req())).rejects.toThrow()
})
test('开关撤销保留内容，覆盖后的撤销不能回写', async () => {
  expect(modules.undoModule).toBeTypeOf('function')
  const original = await prisma.module.findUniqueOrThrow({ where: { key: 'log' } })
  try {
    const changed = await modules.updateModule('log', { enabled: !original.enabled }, req())
    expect(changed.undo).toBeDefined()
    await modules.undoModule('log', { auditId: changed.undo!.auditId }, req('POST'))
    expect((await prisma.module.findUniqueOrThrow({ where: { key: 'log' } })).enabled).toBe(
      original.enabled,
    )
    const second = await modules.updateModule('log', { enabled: !original.enabled }, req())
    await modules.updateModule('log', { navLabel: '已覆盖' }, req())
    await expect(
      modules.undoModule('log', { auditId: second.undo!.auditId }, req('POST')),
    ).rejects.toMatchObject({ status: 409 })
  } finally {
    await prisma.module.update({
      where: { key: 'log' },
      data: { enabled: original.enabled, navLabel: original.navLabel },
    })
  }
})
test('路由跨模块并发只允许一个成功且保留历史', async () => {
  expect(modules.updateModule).toBeTypeOf('function')
  const before = await prisma.module.findMany({ where: { key: { in: ['article', 'log'] } } })
  const route = `/race-${Date.now()}`
  try {
    const result = await Promise.allSettled(
      ['article', 'log'].map((key) => modules.updateModule(key, { route }, req())),
    )
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      (result.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.status,
    ).toBe(409)
    for (const item of before) {
      if ((await prisma.module.findUniqueOrThrow({ where: { key: item.key } })).route === route)
        expect(await prisma.routeAlias.findUnique({ where: { path: item.route } })).toMatchObject({
          moduleKey: item.key,
        })
    }
  } finally {
    for (const item of before)
      await prisma.module.update({ where: { key: item.key }, data: { route: item.route } })
    await prisma.routeAlias.deleteMany({
      where: { path: { in: [route, ...before.map((m) => m.route)] } },
    })
  }
})

test('写权限、排序原子CAS、未知字段、已过期撤销', async () => {
  const original = await prisma.module.findUniqueOrThrow({ where: { key: 'article' } })
  try {
    await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
    expect(await modules.listAdminModules(req('GET'))).toHaveLength(6)
    await expect(modules.updateModule('article', { name: '越权' }, req())).rejects.toMatchObject({
      status: 403,
    })
    await modules.reorderModules({ items: [{ key: 'article', navOrder: 4 }] }, req()).then(
      () => {
        throw new Error('越权成功')
      },
      (error) => expect(error.status).toBe(403),
    )
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
    await expect(
      modules.reorderModules(
        {
          items: [
            { key: 'article', navOrder: 4 },
            { key: 'article', navOrder: 5 },
          ],
        },
        req(),
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      modules.reorderModules(
        { items: [{ key: 'article', navOrder: 5, expectedUpdatedAt: '2000-01-01T00:00:00Z' }] },
        req(),
      ),
    ).rejects.toMatchObject({ status: 409 })
    await expect(modules.updateModule('article', { key: 'log' }, req())).rejects.toThrow()
    const toggle = await modules.updateModule('article', { enabled: !original.enabled }, req())
    await prisma.auditLog.update({
      where: { id: toggle.undo!.auditId },
      data: { createdAt: new Date(Date.now() - 6000) },
    })
    await expect(
      modules.undoModule('article', { auditId: toggle.undo!.auditId }, req('POST')),
    ).rejects.toMatchObject({ status: 409 })
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
    await prisma.module.update({
      where: { key: 'article' },
      data: { enabled: original.enabled, navOrder: original.navOrder },
    })
  }
})
test('已知嵌套patch/null、路线保留和历史恢复', async () => {
  const original = await prisma.module.findUniqueOrThrow({ where: { key: 'article' } })
  const route = `/custom-${Date.now()}`
  try {
    const result = await modules.updateModule(
      'article',
      { config: { home: { limit: 2 }, intro: null }, navLabel: null },
      req(),
    )
    expect(result.module.config).toMatchObject({ intro: null, home: { limit: 2, enabled: true } })
    await expect(
      modules.updateModule('article', { config: { home: { enabled: null } } }, req()),
    ).rejects.toThrow()
    await expect(
      modules.updateModule('article', { route: '/admin/nested' }, req()),
    ).rejects.toMatchObject({ status: 409 })
    await modules.updateModule('article', { route }, req())
    await expect(
      modules.updateModule('log', { route: original.route }, req()),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      modules.updateModule('article', { route: `${original.route}/nested` }, req()),
    ).rejects.toMatchObject({ status: 409 })
    await modules.updateModule('article', { route: original.route }, req())
    expect(await prisma.routeAlias.findUnique({ where: { path: route } })).toMatchObject({
      moduleKey: 'article',
    })
  } finally {
    await prisma.module.update({
      where: { key: 'article' },
      data: { route: original.route, config: original.config!, navLabel: original.navLabel },
    })
    await prisma.routeAlias.deleteMany({ where: { path: { in: [route, original.route] } } })
  }
})
