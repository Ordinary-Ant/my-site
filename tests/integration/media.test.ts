import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import { ArticleCreateSchema } from '@/lib/validators/article'
import { safeContentUrl } from '@/lib/markdown'
import { GET as publicMedia } from '@/app/api/v1/media/[id]/route'
import {
  uploadLocalMedia,
  listMedia,
  getMedia,
  updateMedia,
  mediaReferences,
  deleteMedia,
} from '@/lib/services/media'

let userId: string
let token: string
const mediaIds: string[] = []
const articleIds: string[] = []
const request = (method = 'POST') =>
  new Request('http://localhost:3000/api/v1/admin/media', {
    method,
    headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' },
  })
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: '媒体验收',
      email: `media-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: `media-${user.id}` }, request()))
    .accessToken
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { id: { in: articleIds } } })
  for (const id of mediaIds) {
    try {
      await deleteMedia(id, request('DELETE'))
    } catch {}
  }
  await prisma.uploadIntent.deleteMany({ where: { userId } })
  await prisma.rateLimit.deleteMany({ where: { key: `upload:${userId}` } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('真实Local上传去重、编辑、包含软删引用检查与删除', async () => {
  const bytes = await sharp({
    create: {
      width: 3,
      height: 4,
      channels: 3,
      background: { r: Math.floor(Math.random() * 255), g: 56, b: 32 },
    },
  })
    .png()
    .toBuffer()
  const file = new File([new Uint8Array(bytes)], '../../attack.html', { type: 'image/png' })
  const media = await uploadLocalMedia(file, { alt: '图片', folder: '/tests' }, request())
  mediaIds.push(media.id)
  const publicResponse = await publicMedia(new Request(`http://localhost:3000${media.url}`), {
    params: Promise.resolve({ id: media.id }),
  })
  expect(publicResponse.status).toBe(200)
  expect(publicResponse.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await publicResponse.arrayBuffer())).toEqual(bytes)
  expect(media.filename).toMatch(/^[a-f0-9-]{36}\.png$/)
  expect((await uploadLocalMedia(file, {}, request())).id).toBe(media.id)
  expect(
    (await listMedia(new URLSearchParams({ folder: '/tests' }), request('GET'))).data.some(
      (item) => item.id === media.id,
    ),
  ).toBe(true)
  expect(
    (await updateMedia(media.id, { alt: '修改', folder: '/tests/new' }, request('PATCH'))).alt,
  ).toBe('修改')
  expect((await getMedia(media.id, request('GET'))).url).toBe(media.url)
  const article = await prisma.article.create({
    data: {
      title: '引用测试',
      slug: `media-ref-${Date.now()}`,
      content: `![图](${media.url})`,
      deletedAt: new Date(),
    },
  })
  articleIds.push(article.id)
  expect(
    (await mediaReferences(media.id, request('GET'))).some((ref) => ref.id === article.id),
  ).toBe(true)
  await expect(deleteMedia(media.id, request('DELETE'))).rejects.toMatchObject({ status: 409 })
  await prisma.article.delete({ where: { id: article.id } })
  await deleteMedia(media.id, request('DELETE'))
  expect(
    (
      await publicMedia(new Request(`http://localhost:3000${media.url}`), {
        params: Promise.resolve({ id: media.id }),
      })
    ).status,
  ).toBe(404)
  await expect(getMedia(media.id, request('GET'))).rejects.toMatchObject({ status: 404 })
})
test('引用扫描覆盖日志图集、作品图集、档案与嵌套设置，含软删数据', async () => {
  const bytes = await sharp({
    create: { width: 11, height: 12, channels: 3, background: 'orange' },
  })
    .png()
    .toBuffer()
  const media = await uploadLocalMedia(
    new File([new Uint8Array(bytes)], 'ref.png', { type: 'image/png' }),
    {},
    request(),
  )
  mediaIds.push(media.id)
  const suffix = `${Date.now()}-${userId}`
  const log = await prisma.log.create({
    data: {
      title: '日志引用',
      content: '正文',
      logDate: new Date(),
      images: [media.url],
      deletedAt: new Date(),
    },
  })
  const project = await prisma.project.create({
    data: {
      title: '作品引用',
      slug: `media-${suffix}`,
      description: '测试',
      gallery: [media.url],
      deletedAt: new Date(),
    },
  })
  const profile = await prisma.profile.create({
    data: {
      id: `media-${suffix}`,
      name: '测试档案',
      headline: '测试',
      bio: '测试',
      avatar: media.url,
    },
  })
  const setting = await prisma.setting.create({
    data: {
      key: `media-${suffix}`,
      value: {
        nested: {
          array: [
            {
              invalid: '%ZZ %E0%A4%A',
              image: media.url.replace(
                media.id,
                Array.from(media.id, (char) => `%${char.charCodeAt(0).toString(16)}`).join(''),
              ),
            },
          ],
        },
      },
    },
  })
  try {
    const refs = await mediaReferences(media.id, request('GET'))
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'log', id: log.id, field: 'images' }),
        expect.objectContaining({ type: 'project', id: project.id, field: 'gallery' }),
        expect.objectContaining({ type: 'profile', id: profile.id, field: 'avatar' }),
        expect.objectContaining({ type: 'setting', id: setting.key, field: 'value' }),
      ]),
    )
    await expect(deleteMedia(media.id, request('DELETE'))).rejects.toMatchObject({ status: 409 })
  } finally {
    await prisma.log.delete({ where: { id: log.id } })
    await prisma.project.delete({ where: { id: project.id } })
    await prisma.profile.delete({ where: { id: profile.id } })
    await prisma.setting.delete({ where: { key: setting.key } })
  }
})
test.each([
  ['coverImage', 'lower'],
  ['content', 'upper'],
  ['content', 'double'],
  ['content', 'deep'],
  ['content', 'split'],
  ['content', 'entity'],
  ['content', 'entity-percent'],
  ['content', 'malformed'],
] as const)('百分号编码引用保护：%s/%s', async (field, encoding) => {
  const bytes = await sharp({
    create: { width: 13, height: 14, channels: 3, background: 'cyan' },
  })
    .png()
    .toBuffer()
  const media = await uploadLocalMedia(
    new File([new Uint8Array(bytes)], 'encoded.png', { type: 'image/png' }),
    {},
    request(),
  )
  mediaIds.push(media.id)
  let encoded = Array.from(media.id, (char) => `%${char.charCodeAt(0).toString(16)}`).join('')
  if (encoding === 'upper') encoded = encoded.toUpperCase()
  if (encoding === 'double') encoded = encoded.replaceAll('%', '%25')
  if (encoding === 'deep') encoded = encoded.replaceAll('%', `%${'25'.repeat(10)}`)
  if (encoding === 'split') encoded = encoded.replaceAll('%', '%25').replaceAll('6', '%36')
  if (encoding === 'entity')
    encoded = Array.from(media.id, (char) => `&#${char.charCodeAt(0)};`).join('')
  if (encoding === 'entity-percent') encoded = encoded.replaceAll('%', '&#37;')
  const url = `/api/v1/media/${encoded}?size=large#image`
  expect(safeContentUrl(url)).toBe(url)
  if (!['double', 'deep', 'split', 'entity', 'entity-percent'].includes(encoding)) {
    expect(
      (
        await publicMedia(new Request(`http://localhost:3000${url}`), {
          params: Promise.resolve({ id: decodeURIComponent(encoded) }),
        })
      ).status,
    ).toBe(200)
  }
  const { tagIds: _tagIds, ...input } = ArticleCreateSchema.parse({
    title: '编码引用',
    content:
      field === 'content'
        ? `${encoding === 'malformed' ? '异常 %ZZ %E0%A4%A 100%\n' : ''}![图](${url})`
        : '正文',
    ...(field === 'coverImage' ? { coverImage: url } : {}),
  })
  const article = await prisma.article.create({
    data: {
      ...input,
      slug: `encoded-media-${Date.now()}-${encoding}`,
      deletedAt: new Date(),
    },
  })
  articleIds.push(article.id)
  try {
    await expect(deleteMedia(media.id, request('DELETE'))).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_IN_USE',
    })
    expect(await mediaReferences(media.id, request('GET'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'article', id: article.id, field })]),
    )
    expect(await prisma.media.findUnique({ where: { id: media.id } })).not.toBeNull()
  } finally {
    await prisma.article.delete({ where: { id: article.id } })
  }
})

test('非法文件、超限、Viewer写入和用户停用被service拦截', async () => {
  await expect(
    uploadLocalMedia(new File(['<svg/>'], 'fake.png', { type: 'image/png' }), {}, request()),
  ).rejects.toMatchObject({ status: 415 })
  await expect(
    uploadLocalMedia(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
      {},
      request(),
    ),
  ).rejects.toMatchObject({ status: 413 })
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  await expect(
    uploadLocalMedia(new File(['x'], 'fake.png', { type: 'image/png' }), {}, request()),
  ).rejects.toMatchObject({ status: 403 })
  await listMedia(new URLSearchParams(), request('GET'))
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: false } })
  await expect(listMedia(new URLSearchParams(), request('GET'))).rejects.toMatchObject({
    status: 401,
  })
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
})
test('上传限流以PG用户桶共享20次每小时', async () => {
  await prisma.rateLimit.upsert({
    where: { key: `upload:${userId}` },
    create: { key: `upload:${userId}`, count: 20, expiresAt: new Date(Date.now() + 3600000) },
    update: { count: 20, expiresAt: new Date(Date.now() + 3600000) },
  })
  await expect(
    uploadLocalMedia(new File(['x'], 'fake.png', { type: 'image/png' }), {}, request()),
  ).rejects.toMatchObject({ status: 429 })
  await prisma.rateLimit.delete({ where: { key: `upload:${userId}` } })
})
