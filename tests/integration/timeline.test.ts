import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import { revalidateTag } from 'next/cache'
import { signAccessToken } from '@/lib/auth/tokens'
import * as service from '@/lib/services/timeline'
import * as publicRoute from '@/app/api/v1/timeline/route'
import * as createRoute from '@/app/api/v1/admin/timeline/route'
import * as editRoute from '@/app/api/v1/admin/timeline/[id]/route'
import * as restoreRoute from '@/app/api/v1/admin/timeline/[id]/restore/route'
import * as purgeRoute from '@/app/api/v1/admin/timeline/[id]/purge/route'
import * as reorderRoute from '@/app/api/v1/admin/timeline/reorder/route'
const prefix = 'timeline-' + Date.now(),
  ids: string[] = [],
  users: string[] = [],
  tokens: Record<string, string> = {}
let timeline: Awaited<ReturnType<typeof prisma.module.findUnique>>,
  about: typeof timeline,
  profile: Awaited<ReturnType<typeof prisma.profile.findUnique>>
const req = (role = 'ADMIN', origin = 'http://localhost:3000', method = 'POST', body?: unknown) =>
  new Request('http://localhost:3000/api/v1/admin/timeline', {
    method,
    headers: {
      authorization: 'Bearer ' + tokens[role],
      origin,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const make = async (extra: Record<string, unknown> = {}) => {
  const item = await service.createTimeline(
    { title: prefix, type: 'WORK', startDate: '2024-02', ...extra },
    req(),
  )
  ids.push(item.id)
  return item
}
beforeAll(async () => {
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER'] as const) {
    const user = await prisma.user.create({
      data: {
        name: prefix,
        email: prefix + role.toLowerCase() + '@example.com',
        passwordHash: await bcrypt.hash('TestPass123', 4),
        role,
      },
    })
    users.push(user.id)
    tokens[role] = (
      await login(user.email, 'TestPass123', { ip: prefix + role }, req())
    ).accessToken
  }
  timeline = await prisma.module.findUnique({ where: { key: 'timeline' } })
  about = await prisma.module.findUnique({ where: { key: 'about' } })
  profile = await prisma.profile.findUnique({ where: { id: 'default' } })
  await prisma.module.upsert({
    where: { key: 'timeline' },
    update: {
      enabled: true,
      config: {
        direction: 'desc',
        types: { WORK: true, EDUCATION: true, PROJECT: true, AWARD: true, MILESTONE: true },
      },
    },
    create: { key: 'timeline', name: '时间线', route: '/timeline' },
  })
  await prisma.module.upsert({
    where: { key: 'about' },
    update: { enabled: true, config: { sections: { experience: true, contact: true } } },
    create: { key: 'about', name: '关于', route: '/about' },
  })
})
afterAll(async () => {
  await prisma.timelineItem.deleteMany({ where: { id: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } })
  await prisma.rateLimit.deleteMany({
    where: { key: { in: users.map((id) => 'adminwrite:' + id) } },
  })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  for (const saved of [timeline, about])
    if (saved)
      await prisma.module.update({
        where: { key: saved.key },
        data: { enabled: saved.enabled, config: saved.config ?? Prisma.JsonNull },
      })
  if (profile)
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: profile.contactVisible, email: profile.email, phone: profile.phone },
    })
  await prisma.$disconnect()
})
test('五类型创建精度、数组替换、null和合并日期重验', async () => {
  for (const type of ['WORK', 'EDUCATION', 'PROJECT', 'AWARD', 'MILESTONE'])
    expect((await make({ type })).type).toBe(type)
  const item = await make({
    description: '正文',
    organization: '公司',
    tags: ['a', 'b'],
    highlights: ['成果'],
    endDate: '2025',
  })
  const updated = await service.updateTimeline(
    item.id,
    { revision: 1, startPrecision: 'YEAR', description: null, tags: [], highlights: ['新'] },
    req(),
  )
  expect(updated.startDate.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  expect(updated.description).toBeNull()
  expect(updated.organization).toBe('公司')
  expect(updated.tags).toEqual([])
  expect(updated.highlights).toEqual(['新'])
  await expect(
    service.updateTimeline(item.id, { revision: 2, startDate: '2026' }, req()),
  ).rejects.toThrow('结束日期')
  await expect(
    service.updateTimeline(item.id, { revision: 2, isCurrent: true }, req()),
  ).rejects.toThrow('结束日期')
  await expect(
    service.updateTimeline(item.id, { revision: 1, title: '陈旧' }, req()),
  ).rejects.toMatchObject({ status: 409 })
  expect(vi.mocked(revalidateTag).mock.calls.flat()).toContain('profile')
})
test('当前、日期方向、同日期order/id，重排不跨日期且回滚并发', async () => {
  const title = prefix + 'sort',
    a = await make({ title, startDate: '2022', order: 9 }),
    b = await make({ title, startDate: '2024', order: 9 }),
    c = await make({ title, startDate: '2024', order: 1 }),
    d = await make({ title, startDate: '2020', isCurrent: true, order: 999 })
  const query = new URLSearchParams({ q: title })
  expect((await service.listPublicTimeline(query)).data.map((x) => x.id)).toEqual([
    d.id,
    c.id,
    b.id,
    a.id,
  ])
  await service.reorderTimeline(
    {
      items: [
        { id: a.id, order: 0, revision: 1 },
        { id: b.id, order: 0, revision: 1 },
      ],
    },
    req(),
  )
  expect((await service.listPublicTimeline(query)).data.map((x) => x.id)).toEqual([
    d.id,
    b.id,
    c.id,
    a.id,
  ])
  await expect(
    service.reorderTimeline(
      {
        items: [
          { id: a.id, order: 8, revision: 2 },
          { id: b.id, order: 4, revision: 1 },
        ],
      },
      req(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect((await prisma.timelineItem.findUniqueOrThrow({ where: { id: a.id } })).order).toBe(0)
  const results = await Promise.allSettled([
    service.reorderTimeline(
      {
        items: [
          { id: a.id, order: 2, revision: 2 },
          { id: b.id, order: 2, revision: 2 },
        ],
      },
      req(),
    ),
    service.reorderTimeline(
      {
        items: [
          { id: b.id, order: 3, revision: 2 },
          { id: a.id, order: 3, revision: 2 },
        ],
      },
      req(),
    ),
  ])
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((x) => x.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  await prisma.module.update({
    where: { key: 'timeline' },
    data: { config: { direction: 'asc', types: { WORK: true } } },
  })
  expect((await service.listPublicTimeline(query)).data.map((x) => x.id)).toEqual([
    d.id,
    a.id,
    c.id,
    b.id,
  ])
  await prisma.module.update({
    where: { key: 'timeline' },
    data: {
      config: {
        direction: 'desc',
        types: { WORK: true, EDUCATION: true, PROJECT: true, AWARD: true, MILESTONE: true },
      },
    },
  })
})
test('公开开关联动、About独立visible仅WORK，软删恢复purge审计', async () => {
  const item = await make({ visible: false, showOnAbout: true }),
    education = await make({ type: 'EDUCATION', visible: false, showOnAbout: true })
  expect((await service.getPublicAboutExperience()).map((x) => x.id)).toContain(item.id)
  expect((await service.getPublicAboutExperience()).map((x) => x.id)).not.toContain(education.id)
  expect(
    (await service.listPublicTimeline(new URLSearchParams({ q: prefix }))).data.map((x) => x.id),
  ).not.toContain(item.id)
  await service.deleteTimeline(item.id, 1, req())
  expect((await service.getPublicAboutExperience()).map((x) => x.id)).not.toContain(item.id)
  expect(
    (
      await service.listAdminTimeline(
        new URLSearchParams({ deleted: 'true' }),
        req('VIEWER', undefined, 'GET'),
      )
    ).data.map((x) => x.id),
  ).toContain(item.id)
  await service.restoreTimeline(item.id, 2, req())
  await service.deleteTimeline(item.id, 3, req())
  await expect(service.purgeTimeline(item.id, 4, req('EDITOR'))).rejects.toMatchObject({
    status: 403,
  })
  await service.purgeTimeline(item.id, 4, req())
  expect(
    await prisma.auditLog.count({ where: { resource: 'timeline', resourceId: item.id } }),
  ).toBe(5)
  await prisma.module.update({
    where: { key: 'timeline' },
    data: { config: { types: { WORK: false } } },
  })
  expect(await service.getPublicAboutExperience()).toEqual([])
  await prisma.module.update({ where: { key: 'timeline' }, data: { enabled: false } })
  expect(await service.listPublicTimeline()).toEqual({ data: [], meta: { total: 0 } })
  await prisma.module.update({
    where: { key: 'timeline' },
    data: { enabled: true, config: { types: { WORK: true } } },
  })
  await prisma.module.update({
    where: { key: 'about' },
    data: { config: { sections: { experience: false } } },
  })
  expect(await service.getPublicAboutExperience()).toEqual([])
  await prisma.module.update({
    where: { key: 'about' },
    data: { config: { sections: { experience: true } } },
  })
})
test('边界查询、日期过滤、同日期id排序、HTTP CRUD与分页', async () => {
  const title = prefix + 'boundaries'
  const a = await make({ title, startDate: '2024-02-28', startPrecision: 'MONTH' })
  const b = await make({ title, startDate: '2024-02' })
  const query = new URLSearchParams({ q: title, from: '2024-02', to: '2024-02' })
  expect((await service.listPublicTimeline(query)).data.map((x) => x.id)).toEqual(
    [a.id, b.id].sort(),
  )
  expect(
    (await service.listPublicTimeline(new URLSearchParams({ q: title, from: '2024-03' }))).meta
      .total,
  ).toBe(0)
  const paged = await service.listAdminTimeline(
    new URLSearchParams({ q: title, pageSize: '1', page: '2' }),
    req('VIEWER', undefined, 'GET'),
  )
  expect(paged.meta).toMatchObject({ total: 2, page: 2, hasPrev: true, hasNext: false })
  for (const query of [
    'type=UNKNOWN',
    'from=2024-02-30',
    'from=2025&to=2024',
    'fields=constructor',
    'preview=secret',
    'q=' + 'a'.repeat(201),
  ])
    expect(
      (await publicRoute.GET(new Request('http://localhost:3000/api/v1/timeline?' + query))).status,
    ).toBe(400)
  const created = await createRoute.POST(
    req('ADMIN', undefined, 'POST', { title, type: 'WORK', startDate: '0001' }),
  )
  expect(created.status).toBe(201)
  const envelope = await created.json()
  ids.push(envelope.data.id)
  expect(envelope.data.startDate).toBe('0001-01-01T00:00:00.000Z')
  const context = { params: Promise.resolve({ id: envelope.data.id }) }
  expect((await editRoute.GET(req('VIEWER', undefined, 'GET'), context)).status).toBe(200)
  expect(
    (
      await reorderRoute.PATCH(
        req('ADMIN', undefined, 'PATCH', {
          items: [{ id: envelope.data.id, order: 4, revision: 1 }],
        }),
      )
    ).status,
  ).toBe(200)
  expect(
    (await editRoute.DELETE(req('ADMIN', undefined, 'DELETE', { revision: 2 }), context)).status,
  ).toBe(204)
  expect(
    (await restoreRoute.POST(req('ADMIN', undefined, 'POST', { revision: 3 }), context)).status,
  ).toBe(200)
  expect(
    (await editRoute.DELETE(req('ADMIN', undefined, 'DELETE', { revision: 4 }), context)).status,
  ).toBe(204)
  expect(
    (await purgeRoute.DELETE(req('ADMIN', undefined, 'DELETE', { revision: 5 }), context)).status,
  ).toBe(204)
  expect((await editRoute.GET(req('VIEWER', undefined, 'GET'), context)).status).toBe(404)
  const revised = await service.updateTimeline(
    a.id,
    { revision: 1, startDate: '2024-02-29', endDate: '9998-12-31' },
    req(),
  )
  expect(revised.startPrecision).toBe('DAY')
  expect(revised.endPrecision).toBe('DAY')
  const current = await service.updateTimeline(
    a.id,
    {
      revision: 2,
      isCurrent: true,
      endDate: null,
      logo: null,
      subtitle: null,
      location: null,
      organization: null,
    },
    req(),
  )
  expect(current.isCurrent).toBe(true)
  expect(current.endDate).toBeNull()
  expect(
    (
      await service.listAdminTimeline(
        new URLSearchParams({ q: title, includeDeleted: 'true' }),
        req('VIEWER', undefined, 'GET'),
      )
    ).meta.total,
  ).toBe(2)
  const foreignSession = await prisma.session.findFirstOrThrow({ where: { userId: users[1] } })
  const forged = await signAccessToken(
    { id: users[0], role: 'ADMIN', name: prefix },
    foreignSession.id,
  )
  const invalidRequest = req('ADMIN', undefined, 'GET')
  invalidRequest.headers.set('authorization', 'Bearer ' + forged)
  await expect(service.getAdminTimeline(a.id, invalidRequest)).rejects.toMatchObject({
    status: 401,
  })
})

test('service三角色、禁用用户、sid撤销、Origin、HTTP状态和隐私字段', async () => {
  const item = await make()
  expect((await service.getAdminTimeline(item.id, req('VIEWER', undefined, 'GET'))).id).toBe(
    item.id,
  )
  await expect(
    service.createTimeline({ title: 'x', type: 'WORK', startDate: '2024' }, req('VIEWER')),
  ).rejects.toMatchObject({ status: 403 })
  expect(
    (
      await service.createTimeline(
        { title: prefix, type: 'AWARD', startDate: '2024' },
        req('EDITOR'),
      )
    ).type,
  ).toBe('AWARD')
  ids.push(
    (
      await prisma.timelineItem.findFirstOrThrow({
        where: { title: prefix, type: 'AWARD' },
        orderBy: { createdAt: 'desc' },
      })
    ).id,
  )
  await expect(
    service.updateTimeline(
      item.id,
      { revision: 1, title: 'x' },
      req('ADMIN', 'https://evil.example'),
    ),
  ).rejects.toMatchObject({ status: 403 })
  await prisma.user.update({ where: { id: users[2] }, data: { isActive: false } })
  await expect(
    service.getAdminTimeline(item.id, req('VIEWER', undefined, 'GET')),
  ).rejects.toMatchObject({ status: 401 })
  await prisma.user.update({ where: { id: users[2] }, data: { isActive: true } })
  await prisma.session.updateMany({ where: { userId: users[2] }, data: { revokedAt: new Date() } })
  await expect(
    service.listAdminTimeline(undefined, req('VIEWER', undefined, 'GET')),
  ).rejects.toMatchObject({ status: 401 })
  expect(
    (
      await createRoute.POST(
        req('ADMIN', undefined, 'POST', { title: 'x', type: 'WORK', startDate: '2023-02-29' }),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await editRoute.PATCH(req('ADMIN', undefined, 'PATCH', { revision: 99, title: 'x' }), {
        params: Promise.resolve({ id: item.id }),
      })
    ).status,
  ).toBe(409)
  expect(
    (await publicRoute.GET(new Request('http://localhost:3000/api/v1/timeline?fields=deletedAt')))
      .status,
  ).toBe(400)
  if (profile) {
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: false, email: 'private@example.com' },
    })
    await service.updateTimeline(
      item.id,
      { revision: 1, description: '联系 private@example.com [邮件](mailto:private@example.com)' },
      req(),
    )
    const data = await service.listPublicTimeline(new URLSearchParams({ q: prefix }))
    expect(JSON.stringify(data)).not.toContain('private@example.com')
    expect(data.data[0]).not.toHaveProperty('deletedAt')
  }
  await prisma.rateLimit.upsert({
    where: { key: 'adminwrite:' + users[0] },
    update: { count: 120, expiresAt: new Date(Date.now() + 900000) },
    create: { key: 'adminwrite:' + users[0], count: 120, expiresAt: new Date(Date.now() + 900000) },
  })
  await expect(
    service.updateTimeline(item.id, { revision: 2, title: '限流' }, req()),
  ).rejects.toMatchObject({ status: 429 })
})
