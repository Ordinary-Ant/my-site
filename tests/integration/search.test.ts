import { beforeAll, afterAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { searchPublicContent, getArticleArchive } from '@/lib/services/search'

const run = 'search-' + randomUUID(),
  originals: Awaited<ReturnType<typeof prisma.module.findMany>> = []
let category = '',
  child = '',
  tag = ''
beforeAll(async () => {
  expect(
    (await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
  ).toMatch(/_test$/)
  originals.push(
    ...(await prisma.module.findMany({ where: { key: { in: ['article', 'log', 'portfolio'] } } })),
  )
  for (const item of originals)
    await prisma.module.update({ where: { key: item.key }, data: { enabled: true, config: {} } })
  category = (await prisma.category.create({ data: { name: run, slug: run } })).id
  child = (
    await prisma.category.create({
      data: { name: run + '-child', slug: run + '-child', parentId: category },
    })
  ).id
  tag = (await prisma.tag.create({ data: { name: run, slug: run } })).id
  await prisma.article.createMany({
    data: Array.from({ length: 65 }, (_, i) => ({
      slug: run + '-' + i,
      title: run + ' ' + i,
      content: '正文 literal %_ and <script>evil</script>',
      categoryId: i % 2 ? category : child,
      status: 'PUBLISHED',
      publishedAt: new Date(Date.UTC(2020, 0, 1, 0, i)),
    })),
  })
  const article = await prisma.article.findUniqueOrThrow({ where: { slug: run + '-0' } })
  await prisma.article.update({
    where: { id: article.id },
    data: { tags: { connect: { id: tag } } },
  })
  await prisma.log.create({
    data: {
      title: run + ' log',
      content: '日志',
      logDate: new Date('2020-01-01'),
      status: 'PUBLISHED',
      publishedAt: new Date('2021-01-01'),
    },
  })
  await prisma.project.create({
    data: {
      slug: run,
      title: run + ' project',
      description: '作品',
      status: 'PUBLISHED',
      publishedAt: new Date('2022-01-01'),
      type: 'REPO',
    },
  })
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { slug: { startsWith: run } } })
  await prisma.log.deleteMany({ where: { title: { startsWith: run } } })
  await prisma.project.deleteMany({ where: { slug: { startsWith: run } } })
  await prisma.category.deleteMany({ where: { id: { in: [child, category] } } })
  if (tag) await prisma.tag.deleteMany({ where: { id: tag } })
  for (const item of originals)
    await prisma.module.update({
      where: { key: item.key },
      data: {
        enabled: item.enabled,
        route: item.route,
        config: item.config === null ? Prisma.JsonNull : item.config,
      },
    })
  await prisma.$disconnect()
})
test('搜索全局分页超过50项仍保留完整总数及类型计数', async () => {
  const first = await searchPublicContent(new URLSearchParams({ q: run, pageSize: '50' }))
  const second = await searchPublicContent(
    new URLSearchParams({ q: run, page: '2', pageSize: '50' }),
  )
  expect(first.meta.total).toBe(67)
  expect(first.meta.typeCounts).toEqual({ article: 65, log: 1, project: 1 })
  expect(first.data[0].type).toBe('project')
  expect(first.data[1].type).toBe('log')
  expect(second.data).toHaveLength(17)
  expect(new Set([...first.data, ...second.data].map((item) => item.id)).size).toBe(67)
  const filtered = await searchPublicContent(new URLSearchParams({ q: run, type: 'log' }))
  expect(filtered.meta.total).toBe(1)
  expect(filtered.meta.typeCounts.article).toBe(65)
  expect((await searchPublicContent(new URLSearchParams('q=%25_'))).meta.total).toBe(65)
  expect((await searchPublicContent(new URLSearchParams('q=x'))).data).toEqual([])
})
test('公开状态/类型/未来日志日期及当前路径边界', async () => {
  const target = await prisma.article.findUniqueOrThrow({ where: { slug: run + '-0' } })
  for (const data of [
    { status: 'DRAFT' as const },
    { status: 'ARCHIVED' as const },
    { deletedAt: new Date() },
    { publishedAt: new Date('2099-01-01') },
  ]) {
    await prisma.article.update({ where: { id: target.id }, data })
    expect(
      (await searchPublicContent(new URLSearchParams({ q: run }))).meta.typeCounts.article,
    ).toBe(64)
    await prisma.article.update({
      where: { id: target.id },
      data: { status: 'PUBLISHED', deletedAt: null, publishedAt: new Date('2020-01-01') },
    })
  }
  await prisma.log.updateMany({
    where: { title: run + ' log' },
    data: { logDate: new Date('2098-01-01') },
  })
  expect((await searchPublicContent(new URLSearchParams({ q: run }))).meta.typeCounts.log).toBe(0)
  await prisma.log.updateMany({ where: { title: run + ' log' }, data: { isPinned: true } })
  expect((await searchPublicContent(new URLSearchParams({ q: run }))).meta.typeCounts.log).toBe(1)
  await prisma.module.update({
    where: { key: 'log' },
    data: { config: { types: { DAILY: false } } },
  })
  expect((await searchPublicContent(new URLSearchParams({ q: run }))).meta.typeCounts.log).toBe(0)
  await prisma.module.update({
    where: { key: 'article' },
    data: { route: '/' + run, enabled: false },
  })
  expect((await searchPublicContent(new URLSearchParams({ q: run }))).meta.typeCounts.article).toBe(
    0,
  )
  await expect(getArticleArchive('category', run, new URLSearchParams())).rejects.toMatchObject({
    status: 404,
  })
  await prisma.module.update({ where: { key: 'article' }, data: { enabled: true } })
  const result = await searchPublicContent(new URLSearchParams({ q: run, type: 'article' }))
  expect(result.data[0].url).toContain('/' + run + '/')
})
test('归档根分类汇总子级，标签仅文章且缺失404', async () => {
  const root = await getArticleArchive('category', run, new URLSearchParams())
  expect(root.pagination.total).toBe(65)
  expect(
    (await getArticleArchive('category', run + '-child', new URLSearchParams())).pagination.total,
  ).toBe(33)
  expect((await getArticleArchive('tag', run, new URLSearchParams())).pagination.total).toBe(1)
  await expect(
    getArticleArchive('tag', run + '-missing', new URLSearchParams()),
  ).rejects.toMatchObject({ status: 404 })
})

test('搜索摘要与归档先执行联系方式清洗，关键词不作为SQL执行', async () => {
  const original = await prisma.profile.findUniqueOrThrow({ where: { id: 'default' } })
  const target = await prisma.article.findUniqueOrThrow({ where: { slug: run + '-0' } })
  try {
    await prisma.profile.update({
      where: { id: 'default' },
      data: {
        email: 'search-private@example.com',
        phone: '+86 139 3333 4444',
        contactVisible: false,
      },
    })
    await prisma.article.update({
      where: { id: target.id },
      data: {
        summary: 'search-private@example.com mailto:search-private@example.com +86 139 3333 4444',
      },
    })
    const result = await searchPublicContent(
      new URLSearchParams({ q: run, pageSize: '50', page: '2' }),
    )
    expect(JSON.stringify(result)).not.toContain('search-private@example.com')
    expect(JSON.stringify(result)).not.toContain('139 3333 4444')
    const archive = await getArticleArchive('tag', run, new URLSearchParams())
    expect(JSON.stringify(archive)).not.toContain('search-private@example.com')
    expect((await searchPublicContent(new URLSearchParams({ q: "' OR 1=1 --" }))).meta.total).toBe(
      0,
    )
  } finally {
    await prisma.profile.update({
      where: { id: 'default' },
      data: {
        email: original.email,
        phone: original.phone,
        contactVisible: original.contactVisible,
      },
    })
    await prisma.article.update({ where: { id: target.id }, data: { summary: target.summary } })
  }
})
