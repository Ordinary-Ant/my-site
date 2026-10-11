import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import { signAccessToken } from '@/lib/auth/tokens'
import { revalidateTag } from 'next/cache'
import * as service from '@/lib/services/profile'
import * as route from '@/app/api/v1/admin/profile/route'
import * as publicRoute from '@/app/api/v1/profile/route'
import { getPublicSite } from '@/lib/services/public-site'
const prefix = 'profile-' + Date.now(),
  users: string[] = [],
  tokens: Record<string, string> = {},
  timelineIds: string[] = []
let original: Awaited<ReturnType<typeof prisma.profile.findUnique>>
const savedModules: Awaited<ReturnType<typeof prisma.module.findUnique>>[] = []
const req = (role = 'ADMIN', method = 'PATCH', body?: unknown, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/v1/admin/profile', {
    method,
    headers: {
      authorization: 'Bearer ' + tokens[role],
      origin,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const update = async (patch: Record<string, unknown>) => {
  const before = await service.getAdminProfile(req('ADMIN', 'GET'))
  return service.updateProfile({ revision: before.revision, ...patch }, req())
}
beforeAll(async () => {
  original = await prisma.profile.findUnique({ where: { id: 'default' } })
  for (const key of ['about', 'timeline']) {
    savedModules.push(await prisma.module.findUnique({ where: { key } }))
    await prisma.module.upsert({
      where: { key },
      update: { enabled: true, config: {} },
      create: { key, name: key, route: '/' + key },
    })
  }
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
})
afterAll(async () => {
  await prisma.profile.deleteMany({ where: { id: 'default' } })
  if (original)
    await prisma.profile.create({
      data: {
        ...original,
        socials: original.socials ?? Prisma.JsonNull,
        advantages: original.advantages ?? Prisma.JsonNull,
        skills: original.skills ?? Prisma.JsonNull,
        services: original.services ?? Prisma.JsonNull,
      },
    })
  for (let index = 0; index < savedModules.length; index++) {
    const saved = savedModules[index],
      key = ['about', 'timeline'][index]
    if (saved)
      await prisma.module.update({
        where: { key },
        data: { enabled: saved.enabled, config: saved.config ?? Prisma.JsonNull },
      })
    else await prisma.module.delete({ where: { key } })
  }
  await prisma.timelineItem.deleteMany({ where: { id: { in: timelineIds } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } })
  await prisma.rateLimit.deleteMany({
    where: { key: { in: users.map((id) => 'adminwrite:' + id) } },
  })
  await prisma.user.deleteMany({ where: { id: { in: users } } })
  await prisma.$disconnect()
})
test('空表GET不写入，首次并发创建仅一个成功并审计', async () => {
  await prisma.profile.deleteMany({ where: { id: 'default' } })
  expect(await service.getAdminProfile(req('VIEWER', 'GET'))).toMatchObject({
    name: '待完善',
    headline: '个人网站',
    bio: '',
    revision: 0,
  })
  expect(await prisma.profile.count()).toBe(0)
  const results = await Promise.allSettled([
    service.updateProfile({ revision: 0, name: '作者' }, req()),
    service.updateProfile({ revision: 0, name: '另一个' }, req()),
  ])
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((x) => x.status === 'rejected')).toMatchObject({
    reason: { status: 409, code: 'REVISION_CONFLICT' },
  })
  expect(await prisma.profile.findUnique({ where: { id: 'default' } })).toMatchObject({
    revision: 1,
  })
  expect(
    await prisma.auditLog.count({
      where: { userId: users[0], resource: 'profile', action: 'create' },
    }),
  ).toBe(1)
})
test('合并重验、数组替换/null清空与并发CAS拒绝旧稿', async () => {
  const first = await update({
    location: '上海',
    birthday: '0001-01-01',
    advantages: [{ title: '优势', description: '内容', icon: 'star' }],
  })
  const next = await service.updateProfile(
    { revision: first.revision, location: null, advantages: [], bio: '' },
    req('EDITOR'),
  )
  expect(next).toMatchObject({ location: null, advantages: [], birthday: '0001-01-01' })
  await expect(
    service.updateProfile({ revision: first.revision, name: '旧稿' }, req()),
  ).rejects.toMatchObject({ status: 409 })
  const outcomes = await Promise.allSettled([
    service.updateProfile({ revision: next.revision, name: '甲' }, req()),
    service.updateProfile({ revision: next.revision, name: '乙' }, req()),
  ])
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.find((x) => x.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  expect(revalidateTag).toHaveBeenCalledWith('profile')
  expect(revalidateTag).toHaveBeenCalledWith('setting')
  for (const patch of [
    { name: '' },
    { unknown: true },
    { experience: [] },
    { birthday: '2023-02-29' },
    { socials: [{ platform: 'x', label: 'x', icon: 'x', url: 'data:x' }] },
  ])
    expect(
      (await route.PATCH(req('ADMIN', 'PATCH', { revision: next.revision + 1, ...patch }))).status,
    ).toBe(400)
})
test('公开字段白名单、区块开关、同源经历和About关闭404', async () => {
  await update({
    bio: '介绍',
    services: [{ title: '服务', description: '说明', icon: 'code' }],
    email: 'private@example.com',
    contactVisible: true,
  })
  const work = await prisma.timelineItem.create({
    data: {
      title: prefix,
      type: 'WORK',
      startDate: new Date('2024-01-01'),
      visible: false,
      showOnAbout: true,
    },
  })
  timelineIds.push(work.id)
  const publicValue = await service.getPublicProfile()
  expect(publicValue.experience?.some((item) => item.id === work.id)).toBe(true)
  for (const key of ['birthday', 'revision', 'updatedAt', 'id'])
    expect(publicValue).not.toHaveProperty(key)
  expect(publicValue.experience?.[0]).not.toHaveProperty('revision')
  expect(
    (await publicRoute.GET(new Request('http://localhost:3000/api/v1/profile?fields=birthday')))
      .status,
  ).toBe(400)
  expect(await service.getPublicProfile(new URLSearchParams('fields=name,headline'))).toEqual({
    name: publicValue.name,
    headline: publicValue.headline,
  })
  await prisma.module.update({
    where: { key: 'about' },
    data: {
      config: {
        sections: {
          bio: false,
          advantages: false,
          skills: false,
          experience: false,
          services: false,
          contact: false,
        },
      },
    },
  })
  const hidden = await service.getPublicProfile()
  for (const key of ['bio', 'advantages', 'skills', 'experience', 'services', 'email', 'phone'])
    expect(hidden).not.toHaveProperty(key)
  expect(hidden).not.toHaveProperty('socials')
  expect(await service.getPublicProfile(new URLSearchParams('fields=socials'))).toEqual({})
  const site = await getPublicSite()
  expect(site.profile).not.toHaveProperty('bio')
  expect(site.profile).not.toHaveProperty('services')
  await prisma.module.update({ where: { key: 'about' }, data: { enabled: false } })
  expect((await publicRoute.GET(new Request('http://localhost:3000/api/v1/profile'))).status).toBe(
    404,
  )
  await prisma.module.update({ where: { key: 'about' }, data: { enabled: true, config: {} } })
})
test('联系方式关闭清洗全DTO的Markdown数组链接且保留安全链接', async () => {
  await update({
    contactVisible: false,
    email: 'private@example.com',
    phone: '13800138000',
    bio: '联系 [邮件](mailto:private@example.com) private@example.com',
    socials: [
      { platform: 'mail', label: '邮件', url: 'mailto:private@example.com', icon: 'mail' },
      { platform: 'web', label: '网站', url: 'https://example.com', icon: 'globe' },
    ],
    services: [{ title: '服务', description: '电话13800138000', icon: 'star' }],
  })
  const value = await service.getPublicProfile()
  expect(JSON.stringify(value)).not.toMatch(/private@example.com|13800138000|mailto:|tel:/)
  expect(value.socials).toEqual([
    { platform: 'web', label: '网站', url: 'https://example.com', icon: 'globe' },
  ])
})
test('服务权威权限、Origin、禁用用户、伪sid与共享PG限流', async () => {
  expect((await route.GET(req('VIEWER', 'GET'))).status).toBe(200)
  expect((await route.PATCH(req('VIEWER', 'PATCH', { revision: 1, name: '拒绝' }))).status).toBe(
    403,
  )
  expect(
    (await route.PATCH(req('ADMIN', 'PATCH', { revision: 1 }, 'https://evil.test'))).status,
  ).toBe(403)
  await prisma.user.update({ where: { id: users[1] }, data: { isActive: false } })
  await expect(service.getAdminProfile(req('EDITOR', 'GET'))).rejects.toMatchObject({ status: 401 })
  await prisma.user.update({ where: { id: users[1] }, data: { isActive: true } })
  tokens.FAKE = await signAccessToken(
    { id: users[0], role: 'ADMIN', name: '测试' },
    'not-a-session',
  )
  await expect(service.getAdminProfile(req('FAKE', 'GET'))).rejects.toMatchObject({ status: 401 })
  await prisma.rateLimit.upsert({
    where: { key: 'adminwrite:' + users[0] },
    update: { count: 120, expiresAt: new Date(Date.now() + 600000) },
    create: { key: 'adminwrite:' + users[0], count: 120, expiresAt: new Date(Date.now() + 600000) },
  })
  expect((await route.PATCH(req('ADMIN', 'PATCH', { revision: 1 }))).status).toBe(429)
})
