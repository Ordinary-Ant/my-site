import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { createServer, type Server } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { login } from '@/lib/services/auth'
import * as audit from '@/lib/services/audit'
import {
  createUploadIntent,
  confirmMedia,
  deleteMedia,
  mediaReferences,
  cleanupUploadIntents,
} from '@/lib/services/media'

// 协议适配服务器验证真实AWS SDK HTTP与PG状态，不代表真实R2凭据/ACL验收。
const objects = new Map<string, Buffer>()
let failDelete = false
let failDeleteKey = ''
let server: Server
let userId: string
let token: string
const mediaIds: string[] = []
const saved = { ...env }
const request = (method = 'POST') =>
  new Request('http://localhost:3000/api/v1/admin/media', {
    method,
    headers: { origin: 'http://localhost:3000', authorization: `Bearer ${token}` },
  })
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const key = new URL(req.url!, 'http://localhost').pathname
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      objects.set(key, Buffer.concat(chunks))
      res.writeHead(200)
      res.end()
      return
    }
    if (req.method === 'DELETE') {
      if (failDelete || key === failDeleteKey) {
        res.writeHead(403)
        res.end('<Error><Code>AccessDenied</Code></Error>')
        return
      }
      objects.delete(key)
      res.writeHead(204)
      res.end()
      return
    }
    const data = objects.get(key)
    if (!data) {
      res.writeHead(404)
      res.end('<Error><Code>NoSuchKey</Code></Error>')
      return
    }
    res.writeHead(200, { 'Content-Length': data.length })
    res.end(data)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  Object.assign(env, {
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    S3_REGION: 'auto',
    S3_BUCKET: 'public-test',
    S3_PRIVATE_BUCKET: 'private-test',
    S3_ACCESS_KEY_ID: 'protocol-test',
    S3_SECRET_ACCESS_KEY: 'protocol-secret',
    S3_PUBLIC_BASE_URL: `http://127.0.0.1:${address.port}/public-test`,
  })
  const user = await prisma.user.create({
    data: {
      name: 'R2协议验收',
      email: `r2-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'EDITOR',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: `r2-${user.id}` }, request())).accessToken
})
afterAll(async () => {
  for (const id of mediaIds) {
    try {
      await deleteMedia(id, request('DELETE'))
    } catch {}
  }
  await prisma.uploadIntent.deleteMany({ where: { userId } })
  await prisma.rateLimit.deleteMany({ where: { key: `upload:${userId}` } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  Object.assign(env, saved)
  await prisma.$disconnect()
})
async function intentFor(bytes: Buffer) {
  return createUploadIntent(
    {
      originalName: '../../original.png',
      mimeType: 'image/png',
      size: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex'),
    },
    request(),
  )
}
test('私有桶直传、实际确认公开、并发消费只有一个成功、临时对象清理', async () => {
  const bytes = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'blue' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  expect(new URL(intent.uploadUrl).pathname).toMatch(/^\/private-test\/private\/upload\//)
  expect(new URL(intent.uploadUrl).searchParams.get('X-Amz-Expires')).toBe('600')
  expect(
    (
      await fetch(intent.uploadUrl, {
        method: 'PUT',
        headers: intent.headers,
        body: new Uint8Array(bytes),
      })
    ).status,
  ).toBe(200)
  const result = await Promise.allSettled([
    confirmMedia({ intentId: intent.intentId }, request()),
    confirmMedia({ intentId: intent.intentId }, request()),
  ])
  expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
  const successful = result.find((item) => item.status === 'fulfilled') as PromiseFulfilledResult<
    Awaited<ReturnType<typeof confirmMedia>>
  >
  const media = successful.value
  mediaIds.push(media.id)
  expect(new URL(media.url).pathname).toMatch(/^\/public-test\/media\//)
  expect(objects.has(new URL(intent.uploadUrl).pathname)).toBe(false)
  expect(await (await fetch(media.url)).arrayBuffer()).toEqual(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  await expect(confirmMedia({ intentId: intent.intentId }, request())).rejects.toMatchObject({
    status: 409,
  })
})
test('R2公开URL的编码路径在嵌套配置中仍阻止删除', async () => {
  const bytes = await sharp({ create: { width: 9, height: 10, channels: 3, background: 'pink' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: new Uint8Array(bytes),
  })
  const media = await confirmMedia({ intentId: intent.intentId }, request())
  mediaIds.push(media.id)
  const url = new URL(media.url)
  const encoded = `${url.origin}${Array.from(
    url.pathname,
    (char) => `%${char.charCodeAt(0).toString(16)}`,
  ).join('')}?v=1#image`
  const setting = await prisma.setting.create({
    data: { key: `encoded-r2-${media.id}`, value: { invalid: '%ZZ', nested: [encoded] } },
  })
  try {
    await expect(deleteMedia(media.id, request('DELETE'))).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_IN_USE',
    })
    expect(await mediaReferences(media.id, request('GET'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'setting', id: setting.key, field: 'value' }),
      ]),
    )
    expect(objects.has(url.pathname)).toBe(true)
  } finally {
    await prisma.setting.delete({ where: { key: setting.key } })
  }
  await deleteMedia(media.id, request('DELETE'))
  expect(objects.has(url.pathname)).toBe(false)
})

test.each([
  ['image', 'escape'],
  ['link', 'escape'],
  ['definition', 'escape'],
  ['image', 'entity'],
  ['link', 'entity'],
  ['definition', 'entity-percent'],
] as const)('R2软删Markdown目标引用保护：%s/%s', async (kind, encoding) => {
  const bytes = await sharp({ create: { width: 17, height: 18, channels: 3, background: 'pink' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: new Uint8Array(bytes),
  })
  const media = await confirmMedia({ intentId: intent.intentId }, request())
  mediaIds.push(media.id)
  const target = media.url
    .replaceAll('-', encoding === 'escape' ? '\\-' : '&#45;')
    .replaceAll('.png', encoding === 'entity-percent' ? '%2epng' : '.png')
  const content =
    kind === 'definition'
      ? `![图][asset]\n\n[asset]: ${target}`
      : `${kind === 'image' ? '!' : ''}[图](${target})`
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content)
  const node =
    kind === 'definition'
      ? tree.children[1]
      : 'children' in tree.children[0]
        ? tree.children[0].children[0]
        : undefined
  expect(node).toMatchObject({
    type: kind,
    url: encoding === 'entity-percent' ? media.url.replace('.png', '%2epng') : media.url,
  })
  const article = await prisma.article.create({
    data: { title: '语义引用', slug: `semantic-${randomUUID()}`, content, deletedAt: new Date() },
  })
  try {
    await expect(deleteMedia(media.id, request('DELETE'))).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_IN_USE',
    })
    expect(await mediaReferences(media.id, request('GET'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'article', id: article.id, field: 'content' }),
      ]),
    )
    expect(objects.has(new URL(media.url).pathname)).toBe(true)
  } finally {
    await prisma.article.delete({ where: { id: article.id } })
  }
})

test.each(['code', 'literal-backslash'] as const)(
  '非Markdown目标不被盲目反转义为引用：%s',
  async (kind) => {
    const bytes = await sharp({
      create: { width: 19, height: 20, channels: 3, background: 'pink' },
    })
      .png()
      .toBuffer()
    const intent = await intentFor(bytes)
    await fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: intent.headers,
      body: new Uint8Array(bytes),
    })
    const media = await confirmMedia({ intentId: intent.intentId }, request())
    mediaIds.push(media.id)
    const target = media.url.replaceAll('-', kind === 'code' ? '\\-' : '\\\\-')
    const content = kind === 'code' ? `\`\`\`md\n![图](${target})\n\`\`\`` : `![图](${target})`
    const article = await prisma.article.create({
      data: {
        title: '非目标引用',
        slug: `literal-${randomUUID()}`,
        content,
        deletedAt: new Date(),
      },
    })
    try {
      expect(await mediaReferences(media.id, request('GET'))).toEqual([])
      await deleteMedia(media.id, request('DELETE'))
      expect(objects.has(new URL(media.url).pathname)).toBe(false)
    } finally {
      await prisma.article.delete({ where: { id: article.id } })
    }
  },
)

test('归属、过期、magic/hash失败不公开且删除临时对象；过期清理可重试', async () => {
  const bytes = await sharp({ create: { width: 6, height: 6, channels: 3, background: 'yellow' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  await prisma.uploadIntent.update({
    where: { id: intent.intentId },
    data: { userId: 'other-owner' },
  })
  await expect(confirmMedia({ intentId: intent.intentId }, request())).rejects.toMatchObject({
    status: 404,
  })
  await prisma.uploadIntent.update({
    where: { id: intent.intentId },
    data: { userId, expiresAt: new Date(0) },
  })
  await expect(confirmMedia({ intentId: intent.intentId }, request())).rejects.toMatchObject({
    status: 409,
  })
  const invalid = await intentFor(bytes)
  const key = new URL(invalid.uploadUrl).pathname
  objects.set(key, Buffer.from('<html>not an image</html>'))
  await expect(confirmMedia({ intentId: invalid.intentId }, request())).rejects.toMatchObject({
    status: 415,
  })
  expect(objects.has(key)).toBe(false)
  expect(
    (await prisma.uploadIntent.findUniqueOrThrow({ where: { id: invalid.intentId } })).status,
  ).toBe('FAILED')
  const mismatch = await intentFor(bytes)
  objects.set(new URL(mismatch.uploadUrl).pathname, bytes)
  await prisma.uploadIntent.update({
    where: { id: mismatch.intentId },
    data: { hash: '0'.repeat(64) },
  })
  await expect(confirmMedia({ intentId: mismatch.intentId }, request())).rejects.toMatchObject({
    status: 422,
  })
  await cleanupUploadIntents(request())
  expect(await prisma.uploadIntent.findUnique({ where: { id: intent.intentId } })).toBeNull()
})
test('存储删除失败保留持久清理队列，重试不会丢失对象key', async () => {
  const bytes = await sharp({ create: { width: 7, height: 7, channels: 3, background: 'purple' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: new Uint8Array(bytes),
  })
  const media = await confirmMedia({ intentId: intent.intentId }, request())
  mediaIds.push(media.id)
  failDelete = true
  try {
    expect(await deleteMedia(media.id, request('DELETE'))).toMatchObject({
      id: media.id,
      cleanupPending: true,
    })
  } finally {
    failDelete = false
  }
  expect(await prisma.media.findUnique({ where: { id: media.id } })).toBeNull()
  expect(
    await prisma.uploadIntent.findFirst({ where: { key: media.key, status: 'DELETE' } }),
  ).not.toBeNull()
  await cleanupUploadIntents(request())
  expect(objects.has(new URL(media.url).pathname)).toBe(false)
  expect(await prisma.uploadIntent.findFirst({ where: { key: media.key } })).toBeNull()
})
test('公开写入后DB回滚且存储删除失败仍有持久补偿key', async () => {
  const bytes = await sharp({ create: { width: 8, height: 9, channels: 3, background: 'green' } })
    .png()
    .toBuffer()
  const intent = await intentFor(bytes)
  await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: new Uint8Array(bytes),
  })
  const spy = vi.spyOn(audit, 'writeAudit').mockRejectedValueOnce(new Error('事务审计故障'))
  failDelete = true
  try {
    await expect(confirmMedia({ intentId: intent.intentId }, request())).rejects.toThrow()
  } finally {
    spy.mockRestore()
    failDelete = false
  }
  const queue = await prisma.uploadIntent.findFirst({ where: { userId, status: 'COMPENSATE' } })
  expect(queue).not.toBeNull()
  expect(
    await prisma.media.findFirst({
      where: { hash: createHash('sha256').update(bytes).digest('hex') },
    }),
  ).toBeNull()
  await prisma.uploadIntent.updateMany({
    where: { userId, status: { in: ['COMPENSATE', 'FAILED'] } },
    data: { expiresAt: new Date(0) },
  })
  await cleanupUploadIntents(request())
  expect(objects.has(`/public-test/${queue!.key}`)).toBe(false)
  expect(
    await prisma.auditLog.findFirst({ where: { userId, action: 'cleanup', resource: 'media' } }),
  ).not.toBeNull()
})
test('清理单key403继续清理后续对象，失败票据保留并审计结果', async () => {
  const createQueue = async () =>
    prisma.uploadIntent.create({
      data: {
        userId,
        key: `private/upload/${randomUUID()}`,
        originalName: '清理测试',
        mimeType: 'image/png',
        size: 1,
        hash: '0'.repeat(64),
        status: 'FAILED',
        expiresAt: new Date(0),
        updatedAt: new Date(0),
      },
    })
  const first = await createQueue()
  const second = await createQueue()
  objects.set(`/private-test/${first.key}`, Buffer.from('x'))
  objects.set(`/private-test/${second.key}`, Buffer.from('x'))
  failDeleteKey = `/private-test/${first.key}`
  let result
  try {
    result = await cleanupUploadIntents(request())
  } finally {
    failDeleteKey = ''
  }
  expect(result).toMatchObject({ cleaned: 1, failed: 1, pending: 1 })
  expect(await prisma.uploadIntent.findUnique({ where: { id: first.id } })).not.toBeNull()
  expect(await prisma.uploadIntent.findUnique({ where: { id: second.id } })).toBeNull()
  expect(objects.has(`/private-test/${second.key}`)).toBe(false)
  expect(
    await prisma.auditLog.findFirst({
      where: { userId, action: 'cleanup-failed', resourceId: first.id },
    }),
  ).not.toBeNull()
  await cleanupUploadIntents(request())
})
test('失败批次移到队尾，100个坏key不饿死第101项', async () => {
  const bad = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      prisma.uploadIntent.create({
        data: {
          userId,
          key: `invalid-${randomUUID()}`,
          originalName: '坏key测试',
          mimeType: 'image/png',
          size: 1,
          hash: '0'.repeat(64),
          status: 'FAILED',
          expiresAt: new Date(0),
          updatedAt: new Date(i),
        },
      }),
    ),
  )
  const last = await prisma.uploadIntent.create({
    data: {
      userId,
      key: `private/upload/${randomUUID()}`,
      originalName: '正常key测试',
      mimeType: 'image/png',
      size: 1,
      hash: '0'.repeat(64),
      status: 'FAILED',
      expiresAt: new Date(0),
      updatedAt: new Date(101),
    },
  })
  try {
    expect(await cleanupUploadIntents(request())).toMatchObject({
      cleaned: 0,
      failed: 100,
      pending: 101,
    })
    expect(await cleanupUploadIntents(request())).toMatchObject({
      cleaned: 1,
      failed: 99,
      pending: 100,
    })
    expect(await prisma.uploadIntent.findUnique({ where: { id: last.id } })).toBeNull()
  } finally {
    await prisma.uploadIntent.deleteMany({
      where: { id: { in: [...bad.map((item) => item.id), last.id] } },
    })
  }
})
