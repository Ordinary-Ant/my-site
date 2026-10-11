import { beforeAll, afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicRss, publicSitemap, publicOg } from '@/lib/services/seo'
const run = 'seo-' + randomUUID()
let originals: Awaited<ReturnType<typeof prisma.module.findMany>> = [],
  profile: Awaited<ReturnType<typeof prisma.profile.findUniqueOrThrow>>
let category = '',
  tag = '',
  publishedId = '',
  logId = ''
beforeAll(async () => {
  expect(
    (await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
  ).toMatch(/_test$/)
  originals = await prisma.module.findMany({
    where: { key: { in: ['article', 'log', 'portfolio', 'about'] } },
  })
  for (const m of originals)
    await prisma.module.update({ where: { key: m.key }, data: { enabled: true, config: {} } })
  profile = await prisma.profile.findUniqueOrThrow({ where: { id: 'default' } })
  await prisma.profile.update({
    where: { id: 'default' },
    data: { email: 'seo-private@example.com', phone: '+86 139 1111 2222', contactVisible: false },
  })
  category = (await prisma.category.create({ data: { name: run, slug: run } })).id
  tag = (await prisma.tag.create({ data: { name: run, slug: run } })).id
  for (const status of ['PUBLISHED', 'DRAFT', 'ARCHIVED'] as const) {
    const a = await prisma.article.create({
      data: {
        slug: run + '-' + status,
        title: run + ' <title> ' + status,
        content: '联系 seo-private@example.com mailto:seo-private@example.com +86 139 1111 2222',
        status,
        publishedAt: new Date('2026-01-01'),
        categoryId: category,
        tags: { connect: { id: tag } },
      },
    })
    if (status === 'PUBLISHED') publishedId = a.id
  }
  await prisma.article.create({
    data: {
      slug: run + '-future',
      title: run + ' future',
      content: '未来',
      status: 'PUBLISHED',
      publishedAt: new Date('2099-01-01'),
    },
  })
  await prisma.article.create({
    data: {
      slug: run + '-deleted',
      title: run + ' deleted',
      content: '删除',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-01-01'),
      deletedAt: new Date(),
    },
  })
  logId = (
    await prisma.log.create({
      data: {
        title: run + ' log',
        content: '日志',
        logDate: new Date('2099-01-01'),
        isPinned: false,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-01-01'),
      },
    })
  ).id
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { slug: { startsWith: run } } })
  await prisma.log.deleteMany({ where: { title: { startsWith: run } } })
  if (category) await prisma.category.deleteMany({ where: { id: category } })
  if (tag) await prisma.tag.deleteMany({ where: { id: tag } })
  if (profile)
    await prisma.profile.update({
      where: { id: 'default' },
      data: { email: profile.email, phone: profile.phone, contactVisible: profile.contactVisible },
    })
  for (const m of originals)
    await prisma.module.update({
      where: { key: m.key },
      data: {
        enabled: m.enabled,
        route: m.route,
        config: m.config === null ? Prisma.JsonNull : m.config,
      },
    })
  await prisma.$disconnect()
})
test('RSS和地图不泄露草稿/未来/删除内容，隐私清洗后生成摘要', async () => {
  const rss = await publicRss(),
    sitemap = await publicSitemap()
  expect(rss).toContain(run + '-PUBLISHED')
  expect(rss).toContain('article:' + publishedId)
  expect(rss).toContain('&lt;title&gt;')
  expect(rss).not.toContain('seo-private@example.com')
  expect(rss).not.toContain('139 1111 2222')
  for (const suffix of ['DRAFT', 'ARCHIVED', 'future', 'deleted']) {
    expect(rss).not.toContain(run + '-' + suffix)
    expect(sitemap).not.toContain(run + '-' + suffix)
  }
  expect(sitemap).toContain('/category/' + run)
  expect(sitemap).toContain('/tag/' + run)
  expect(rss).not.toContain('log:' + logId)
  expect(sitemap).not.toContain('/' + logId)
  await prisma.log.update({ where: { id: logId }, data: { isPinned: true } })
  expect(await publicRss()).toContain('log:' + logId)
  await prisma.log.update({ where: { id: logId }, data: { publishedAt: new Date('2099-01-01') } })
  expect(await publicRss()).not.toContain('log:' + logId)
})
test('改路径及关闭栏目同步到所有SEO出口，OG仅公开内容', async () => {
  await prisma.module.update({ where: { key: 'article' }, data: { route: '/' + run } })
  expect(await publicRss()).toContain('/' + run + '/' + run + '-PUBLISHED')
  expect(await publicSitemap()).toContain('/' + run + '/tag/' + run)
  expect(
    (await publicOg(new URLSearchParams({ resource: 'article', id: run + '-PUBLISHED' }))).title,
  ).toContain(run)
  await expect(
    publicOg(new URLSearchParams({ resource: 'article', id: run + '-DRAFT' })),
  ).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({ where: { key: 'article' }, data: { enabled: false } })
  await prisma.module.update({ where: { key: 'log' }, data: { enabled: false } })
  expect(await publicRss()).not.toContain('<item>')
  expect(await publicSitemap()).not.toContain('/' + run + '/')
  await expect(
    publicOg(new URLSearchParams({ resource: 'article', id: run + '-PUBLISHED' })),
  ).rejects.toMatchObject({ status: 404 })
})
