import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import {
  createArticle,
  updateArticle,
  deleteArticle,
  restoreArticle,
  purgeArticle,
  listPublicArticles,
  getPublicArticle,
  createPreviewToken,
  getPreviewArticle,
} from '@/lib/services/article'

let userId: string
let token: string
const ids: string[] = []
const request = (method = 'POST') =>
  new Request('http://localhost:3000/api/v1/admin/articles', {
    method,
    headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' },
  })
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: '文章验收',
      email: `article-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: `article-${user.id}` }, request()))
    .accessToken
  await prisma.module.upsert({
    where: { key: 'article' },
    update: { enabled: true },
    create: { key: 'article', name: '文章', route: '/articles' },
  })
})

test('彻底删除必须提供有效revision，缺字段不能绕过乐观锁', async () => {
  const article = await createArticle({ title: '删除版本合同', content: '正文' }, request())
  ids.push(article.id)
  await deleteArticle(article.id, article.revision, request('DELETE'))
  await expect(
    purgeArticle(article.id, undefined as unknown as number, request('DELETE')),
  ).rejects.toMatchObject({ status: 400 })
  expect(await prisma.article.findUnique({ where: { id: article.id } })).not.toBeNull()
})
afterAll(async () => {
  await prisma.previewToken.deleteMany({ where: { contentId: { in: ids } } })
  await prisma.article.deleteMany({ where: { id: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})

test('文章新建草稿预览发布阅读软删恢复，未来不可公开', async () => {
  const article = await createArticle(
    { title: '真实闭环文章', content: '## 标题\n\n**正文**' },
    request(),
  )
  ids.push(article.id)
  await expect(getPublicArticle(article.slug)).rejects.toMatchObject({ status: 404 })
  const preview = await createPreviewToken(article.id, request())
  expect((await getPreviewArticle(preview.token)).id).toBe(article.id)
  const published = await updateArticle(
    article.id,
    { revision: article.revision, status: 'PUBLISHED', summary: '发布' },
    request('PATCH'),
  )
  expect((await getPublicArticle(article.slug)).title).toBe(article.title)
  await expect(
    updateArticle(
      article.id,
      { revision: article.revision, content: '过期自动保存' },
      request('PATCH'),
    ),
  ).rejects.toMatchObject({ status: 409 })
  await deleteArticle(article.id, published.revision, request('DELETE'))
  await expect(getPublicArticle(article.slug)).rejects.toMatchObject({ status: 404 })
  const deleted = await prisma.article.findUniqueOrThrow({ where: { id: article.id } })
  const restored = await restoreArticle(article.id, deleted.revision, request())
  await updateArticle(
    article.id,
    { revision: restored.revision, publishedAt: '2099-01-01T00:00:00Z' },
    request('PATCH'),
  )
  await expect(getPublicArticle(article.slug)).rejects.toMatchObject({ status: 404 })
  await prisma.previewToken.updateMany({
    where: { contentId: article.id },
    data: { expiresAt: new Date(0) },
  })
  await expect(getPreviewArticle(preview.token)).rejects.toMatchObject({ status: 404 })
})

test('同revision并发更新只有一个成功，module关闭后直读与预览均被拦截', async () => {
  const article = await createArticle(
    { title: '并发验收', content: '原正文', status: 'PUBLISHED' },
    request(),
  )
  ids.push(article.id)
  const results = await Promise.allSettled([
    updateArticle(article.id, { revision: 1, title: '修改甲' }, request('PATCH')),
    updateArticle(article.id, { revision: 1, title: '修改乙' }, request('PATCH')),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  expect(failed.reason.status).toBe(409)
  const preview = await createPreviewToken(article.id, request())
  try {
    await prisma.module.update({ where: { key: 'article' }, data: { enabled: false } })
    await expect(getPublicArticle(article.slug)).rejects.toMatchObject({ status: 404 })
    expect((await listPublicArticles()).data).toEqual([])
    await expect(getPreviewArticle(preview.token)).rejects.toMatchObject({ status: 404 })
  } finally {
    await prisma.module.update({ where: { key: 'article' }, data: { enabled: true } })
  }
})
