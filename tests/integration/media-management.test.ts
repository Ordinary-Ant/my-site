import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import * as media from '@/lib/services/media'
import { readKnownSettings } from '@/lib/services/settings'
import { exportData } from '@/lib/services/data'

const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
const prefix = `/management-${Date.now()}`
const users: { id: string; token: string; role: string; email: string }[] = []
let item: Awaited<ReturnType<typeof media.uploadLocalMedia>>
let ownedMediaId: string | undefined
let folderBefore: Awaited<ReturnType<typeof prisma.setting.findUnique>>
const req = (index = 0, method = 'POST', requestOrigin = origin) =>
  new Request(`${origin}/api/v1/admin/media`, {
    method,
    headers: { authorization: `Bearer ${users[index]?.token || ''}`, origin: requestOrigin },
  })
const jsonReq = (body: unknown, index = 0, requestOrigin = origin) =>
  new Request(`${origin}/api/v1/admin/media`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${users[index]?.token || ''}`,
      origin: requestOrigin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
beforeAll(async () => {
  expect(
    (await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
  ).toMatch(/_test$/)
  folderBefore = await prisma.setting.findUnique({ where: { key: 'media.folders' } })
  for (const role of ['ADMIN', 'EDITOR', 'VIEWER'] as const) {
    const user = await prisma.user.create({
      data: {
        name: '媒体管理验收',
        email: `management-${role.toLowerCase()}-${Date.now()}@example.com`,
        passwordHash: await bcrypt.hash('TestPass123', 4),
        role,
      },
    })
    users.push({ id: user.id, token: '', role, email: user.email })
    const token = (await login(user.email, 'TestPass123', { ip: user.id }, req())).accessToken
    users[users.length - 1].token = token
  }
  const png = await sharp(randomBytes(17 * 19 * 3), {
    raw: { width: 17, height: 19, channels: 3 },
  })
    .png()
    .toBuffer()
  const uploaded = await media.uploadLocalMedia(
    new File([new Uint8Array(png)], `management-${Date.now()}.png`, { type: 'image/png' }),
    { alt: `UniqueAlt${prefix}`, folder: prefix },
    req(),
  )
  // 即使随机字节意外重复，也不能接管已存在的非fixture媒体。
  expect(uploaded.uploadedBy).toBe(users[0].id)
  ownedMediaId = uploaded.id
  item = uploaded
})
afterAll(async () => {
  if (ownedMediaId) {
    const owned = await prisma.media.findFirst({
      where: { id: ownedMediaId, uploadedBy: users[0].id },
    })
    if (owned) await media.deleteMedia(owned.id, req(0, 'DELETE'))
  }
  if (folderBefore)
    await prisma.setting.upsert({
      where: { key: folderBefore.key },
      create: { ...folderBefore, value: folderBefore.value ?? Prisma.JsonNull },
      update: { ...folderBefore, value: folderBefore.value ?? Prisma.JsonNull },
    })
  else await prisma.setting.deleteMany({ where: { key: 'media.folders' } })
  const ids = users.map((u) => u.id)
  await prisma.uploadIntent.deleteMany({ where: { userId: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.rateLimit.deleteMany({
    where: {
      OR: ids.flatMap((id) => [
        { key: `upload:${id}` },
        { key: `adminwrite:${id}` },
        { key: `login:ip:${id}` },
        { key: `login:email:${users.find((u) => u.id === id)!.email}` },
      ]),
    },
  })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

test('q按文件名或alt不区分大小写trim搜索，省略目录全部而根目录精确', async () => {
  expect(
    (
      await media.listMedia(new URLSearchParams({ q: `  uniquealt${prefix}  ` }), req(2, 'GET'))
    ).data.map((m) => m.id),
  ).toContain(item.id)
  expect(
    (
      await media.listMedia(
        new URLSearchParams({ q: item.originalName.toUpperCase() }),
        req(2, 'GET'),
      )
    ).data.map((m) => m.id),
  ).toContain(item.id)
  expect(
    (await media.listMedia(new URLSearchParams({ folder: '/' }), req(2, 'GET'))).data.map(
      (m) => m.id,
    ),
  ).not.toContain(item.id)
  await expect(
    media.listMedia(new URLSearchParams({ q: 'x'.repeat(201) }), req(2, 'GET')),
  ).rejects.toThrow()
})
test('持久目录并发幂等，三角色读取完整统计且内部配置不进入设置与内容JSON', async () => {
  const before = await media.listMediaFolders(req(2, 'GET'))
  await Promise.all([
    media.createMediaFolder({ path: `${prefix}/empty/` }, req()),
    media.createMediaFolder({ path: `${prefix}/empty` }, req(1)),
  ])
  expect(await prisma.setting.findUnique({ where: { key: 'media.folders' } })).toMatchObject({
    group: 'internal',
  })
  const stored = await prisma.setting.findUniqueOrThrow({ where: { key: 'media.folders' } })
  expect((stored.value as string[]).filter((p) => p === `${prefix}/empty`)).toHaveLength(1)
  for (let i = 0; i < 3; i++) {
    const result = await media.listMediaFolders(req(i, 'GET'))
    expect(result).toMatchObject({ total: before.total, totalSize: before.totalSize })
    expect(result.folders).toEqual(
      expect.arrayContaining([
        { path: `${prefix}/empty`, count: 0, size: 0 },
        { path: prefix, count: 1, size: item.size },
      ]),
    )
    expect(result.folders.some((f) => f.path === '/')).toBe(true)
    expect(result.folders.map((f) => f.path)).toEqual(result.folders.map((f) => f.path).sort())
  }
  expect(JSON.stringify(await readKnownSettings())).not.toContain('media.folders')
  expect(JSON.stringify(await exportData(req(0, 'GET')))).not.toContain('media.folders')
})
test('目录严格参数及最多200个登记目录，已有路径保持幂等', async () => {
  for (const input of [
    { path: '/../bad' },
    { path: '//bad' },
    { path: '/ok', unknown: 1 },
    JSON.parse('{"path":"/ok","__proto__":{}}'),
  ])
    await expect(media.createMediaFolder(input, req())).rejects.toThrow()
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key: 'media.folders' } })
  try {
    await prisma.setting.update({
      where: { key: saved.key },
      data: { value: Array.from({ length: 200 }, (_, n) => `/limit-${n}`) },
    })
    expect(await media.createMediaFolder({ path: '/limit-1/' }, req())).toEqual({
      path: '/limit-1',
    })
    expect(await media.createMediaFolder({ path: '/' }, req())).toEqual({ path: '/' })
    await expect(media.createMediaFolder({ path: '/limit-new' }, req())).rejects.toMatchObject({
      status: 409,
      code: 'DIRECTORY_LIMIT',
    })
  } finally {
    await prisma.setting.update({ where: { key: saved.key }, data: { value: saved.value! } })
  }
})
test('秒传跨用户复用已验证媒体且保持metadata，不写新媒体/票据或上传额度', async () => {
  const input = { hash: item.hash, size: item.size, mimeType: item.mimeType }
  const count = await prisma.media.count()
  const intents = await prisma.uploadIntent.count()
  const uploadCount = await prisma.rateLimit.findUnique({ where: { key: `upload:${users[1].id}` } })
  const result = await media.deduplicateMedia(input, req(1))
  expect(result).toMatchObject({
    deduplicated: true,
    media: {
      id: item.id,
      url: item.url,
      alt: item.alt,
      folder: item.folder,
      originalName: item.originalName,
    },
  })
  expect(result.media).not.toHaveProperty('key')
  expect(result.media).not.toHaveProperty('hash')
  expect(result.media).not.toHaveProperty('uploadedBy')
  expect(await prisma.media.count()).toBe(count)
  expect(await prisma.uploadIntent.count()).toBe(intents)
  expect(await prisma.rateLimit.findUnique({ where: { key: `upload:${users[1].id}` } })).toEqual(
    uploadCount,
  )
  expect(await prisma.media.findUnique({ where: { id: item.id } })).toMatchObject({
    alt: item.alt,
    folder: item.folder,
  })
  expect(
    await prisma.auditLog.count({
      where: { userId: users[1].id, action: 'deduplicate', resourceId: item.id },
    }),
  ).toBe(1)
})
test('未命中与类型大小不符不写业务数据，客户端无法覆盖metadata', async () => {
  const audits = await prisma.auditLog.count({ where: { action: 'deduplicate' } })
  for (const input of [
    { hash: '0'.repeat(64), size: item.size, mimeType: item.mimeType },
    { hash: item.hash, size: item.size + 1, mimeType: item.mimeType },
    { hash: item.hash, size: item.size, mimeType: 'image/jpeg' },
  ])
    expect(await media.deduplicateMedia(input, req())).toEqual({ media: null, deduplicated: false })
  expect(await prisma.auditLog.count({ where: { action: 'deduplicate' } })).toBe(audits)
  await expect(
    media.deduplicateMedia({ hash: item.hash, size: item.size, mimeType: 'text/html' }, req()),
  ).rejects.toMatchObject({ status: 415 })
  await expect(
    media.deduplicateMedia(
      { hash: item.hash, size: item.size, mimeType: item.mimeType, alt: '覆盖' },
      req(),
    ),
  ).rejects.toThrow()
})
test('写接口viewer/停用用户/跨Origin失败，PG共享管理额度不被绕过', async () => {
  const operations = [
    (r: Request) => media.createMediaFolder({ path: `${prefix}/auth` }, r),
    (r: Request) =>
      media.deduplicateMedia({ hash: item.hash, size: item.size, mimeType: item.mimeType }, r),
  ]
  for (const op of operations) {
    await expect(op(req(2))).rejects.toMatchObject({ status: 403 })
    await expect(op(req(0, 'POST', 'https://evil.example'))).rejects.toMatchObject({ status: 403 })
  }
  await prisma.user.update({ where: { id: users[2].id }, data: { isActive: false } })
  try {
    await expect(media.listMediaFolders(req(2, 'GET'))).rejects.toMatchObject({ status: 401 })
    for (const op of operations) await expect(op(req(2))).rejects.toMatchObject({ status: 401 })
  } finally {
    await prisma.user.update({ where: { id: users[2].id }, data: { isActive: true } })
  }
  const key = `adminwrite:${users[1].id}`
  await prisma.rateLimit.upsert({
    where: { key },
    create: { key, count: 120, expiresAt: new Date(Date.now() + 900000) },
    update: { count: 120, expiresAt: new Date(Date.now() + 900000) },
  })
  try {
    for (const op of operations) await expect(op(req(1))).rejects.toMatchObject({ status: 429 })
  } finally {
    await prisma.rateLimit.delete({ where: { key } })
  }
})
test('目录上限199时跨用户并发只允许一个新目录成功', async () => {
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key: 'media.folders' } })
  try {
    await prisma.setting.update({
      where: { key: saved.key },
      data: { value: Array.from({ length: 199 }, (_, n) => `/race-${n}`) },
    })
    const results = await Promise.allSettled([
      media.createMediaFolder({ path: `${prefix}/race-a` }, req()),
      media.createMediaFolder({ path: `${prefix}/race-b` }, req(1)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'DIRECTORY_LIMIT' },
    })
    expect(
      (await prisma.setting.findUniqueOrThrow({ where: { key: saved.key } })).value,
    ).toHaveLength(200)
  } finally {
    await prisma.setting.update({ where: { key: saved.key }, data: { value: saved.value! } })
  }
})
test('失效sid拒绝读取和写入，原型名不是受支持媒体类型', async () => {
  await expect(
    media.deduplicateMedia({ hash: item.hash, size: item.size, mimeType: 'constructor' }, req()),
  ).rejects.toMatchObject({ status: 415 })
  const session = await prisma.session.findFirstOrThrow({
    where: { userId: users[2].id, revokedAt: null },
  })
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
  try {
    await expect(media.listMediaFolders(req(2, 'GET'))).rejects.toMatchObject({ status: 401 })
    await expect(
      media.createMediaFolder({ path: `${prefix}/expired` }, req(2)),
    ).rejects.toMatchObject({ status: 401 })
    await expect(
      media.deduplicateMedia({ hash: item.hash, size: item.size, mimeType: item.mimeType }, req(2)),
    ).rejects.toMatchObject({ status: 401 })
  } finally {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: null } })
  }
})
test('真实API响应包裹、Origin与参数校验', async () => {
  const folders = await import('@/app/api/v1/admin/media/folders/route')
  const dedup = await import('@/app/api/v1/admin/media/deduplicate/route')
  expect((await folders.GET(req(2, 'GET'))).status).toBe(200)
  expect((await folders.POST(jsonReq({ path: `${prefix}/api` }))).status).toBe(200)
  expect((await folders.POST(jsonReq({ path: '/../bad' }))).status).toBe(400)
  expect(
    (await dedup.POST(jsonReq({ hash: item.hash, size: item.size, mimeType: item.mimeType }, 1)))
      .status,
  ).toBe(200)
  expect(
    (await dedup.POST(jsonReq({ hash: item.hash, size: item.size, mimeType: item.mimeType }, 2)))
      .status,
  ).toBe(403)
})
