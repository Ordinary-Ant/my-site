import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import * as taxonomy from '@/lib/services/taxonomy'
import { todayLogDate } from '@/lib/services/log'
const prefix = `tax-${Date.now()}`
let userId: string, token: string
const categories: string[] = [],
  tags: string[] = [],
  articles: string[] = [],
  logs: string[] = [],
  projects: string[] = []
const req = (method = 'POST', origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/v1/admin/tags', {
    method,
    headers: { authorization: `Bearer ${token}`, origin },
  })
const category = async (data: Record<string, unknown> = {}) => {
  const x = await taxonomy.createCategory(
    { name: '分类', slug: `${prefix}-${categories.length}`, ...data },
    req(),
  )
  categories.push(x.id)
  return x
}
const tag = async () => {
  const x = await taxonomy.createTag({ name: '标签', slug: `${prefix}-${tags.length}` }, req())
  tags.push(x.id)
  return x
}
beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      name: '分类验收',
      email: `${prefix}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = u.id
  token = (await login(u.email, 'TestPass123', { ip: prefix }, req())).accessToken
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { id: { in: articles } } })
  await prisma.log.deleteMany({ where: { id: { in: logs } } })
  await prisma.project.deleteMany({ where: { id: { in: projects } } })
  await prisma.category.deleteMany({ where: { id: { in: categories } } })
  await prisma.tag.deleteMany({ where: { id: { in: tags } } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.rateLimit.deleteMany({ where: { key: `adminwrite:${userId}` } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('分类两层、同父排序与CAS、叶删除递增全部正文revision', async () => {
  const root = await category(),
    child = await category({ parentId: root.id })
  await expect(category({ parentId: child.id })).rejects.toMatchObject({ status: 422 })
  await expect(
    taxonomy.updateCategory(root.id, { revision: 1, parentId: child.id }, req()),
  ).rejects.toMatchObject({ status: 422 })
  await expect(taxonomy.deleteCategory(root.id, { revision: 1 }, req())).rejects.toMatchObject({
    status: 422,
  })
  await expect(
    taxonomy.reorderCategories(
      {
        items: [
          { id: root.id, revision: 1, order: 2 },
          { id: child.id, revision: 1, order: 2 },
        ],
      },
      req(),
    ),
  ).rejects.toMatchObject({ status: 422 })
  const a = await prisma.article.create({
    data: {
      title: '草稿',
      slug: `${prefix}-article`,
      content: '保留正文',
      categoryId: child.id,
      deletedAt: new Date(),
    },
  })
  articles.push(a.id)
  const edited = await taxonomy.updateCategory(
    child.id,
    { revision: 1, name: '新名', slug: `${prefix}-new` },
    req(),
  )
  expect(edited.revision).toBe(2)
  await expect(taxonomy.deleteCategory(child.id, { revision: 1 }, req())).rejects.toMatchObject({
    status: 409,
  })
  await taxonomy.deleteCategory(child.id, { revision: 2 }, req())
  expect(await prisma.article.findUnique({ where: { id: a.id } })).toMatchObject({
    categoryId: null,
    content: '保留正文',
    revision: 2,
  })
})
test('跨三模型合并去重、预览实际计数、删除与内容CAS保护', async () => {
  const target = await tag(),
    source = await tag(),
    source2 = await tag()
  const a = await prisma.article.create({
    data: {
      title: '合并',
      slug: `${prefix}-merge`,
      content: '内容',
      tags: { connect: [{ id: target.id }, { id: source.id }] },
    },
  })
  articles.push(a.id)
  const l = await prisma.log.create({
    data: {
      title: '未来',
      content: '日志',
      logDate: new Date(),
      publishedAt: new Date(Date.now() + 86400000),
      tags: { connect: [{ id: source.id }, { id: source2.id }] },
    },
  })
  logs.push(l.id)
  const p = await prisma.project.create({
    data: {
      title: '已删除',
      slug: `${prefix}-project`,
      description: '作品',
      deletedAt: new Date(),
      tags: { connect: [{ id: source2.id }] },
    },
  })
  projects.push(p.id)
  const body = {
    target: { id: target.id, revision: 1 },
    sources: [
      { id: source.id, revision: 1 },
      { id: source2.id, revision: 1 },
    ],
  }
  const preview = await taxonomy.previewTagMerge(body, req())
  expect(preview.affected).toEqual({ article: 1, log: 1, project: 1, total: 3 })
  expect(preview.additions).toEqual({ article: 0, log: 1, project: 1, total: 2 })
  const merged = await taxonomy.mergeTags(body, req())
  expect(merged.affected).toEqual(preview.affected)
  expect(
    await prisma.article.findUnique({ where: { id: a.id }, include: { tags: true } }),
  ).toMatchObject({ revision: 2, tags: [{ id: target.id }] })
  expect(
    await prisma.log.findUnique({ where: { id: l.id }, include: { tags: true } }),
  ).toMatchObject({ revision: 2, tags: [{ id: target.id }] })
  expect(await prisma.tag.count({ where: { id: { in: [source.id, source2.id] } } })).toBe(0)
  await expect(taxonomy.deleteTag(target.id, { revision: 1 }, req())).rejects.toMatchObject({
    status: 409,
  })
  await taxonomy.deleteTag(target.id, { revision: 2 }, req())
  expect(
    await prisma.project.findUnique({ where: { id: p.id }, include: { tags: true } }),
  ).toMatchObject({ revision: 3, tags: [], description: '作品' })
})
test('批删旧revision全部回滚，未知键/冲突slug与Origin检查', async () => {
  const a = await tag(),
    b = await tag()
  await expect(
    taxonomy.bulkDeleteTags(
      {
        items: [
          { id: a.id, revision: 1 },
          { id: b.id, revision: 99 },
        ],
      },
      req(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect(await prisma.tag.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2)
  await expect(taxonomy.updateTag(a.id, { revision: 1, slug: 'no' }, req())).rejects.toBeDefined()
  await expect(taxonomy.createTag({ name: '重复', slug: a.slug }, req())).rejects.toMatchObject({
    status: 409,
  })
  await expect(
    taxonomy.createTag({ name: 'x', slug: 'x' }, req('POST', 'https://evil.example')),
  ).rejects.toMatchObject({ status: 403 })
})
test('公开词表只保留公开使用、祖先汇总且模块和类型关闭立即清空', async () => {
  const saved = await prisma.module.findMany({
    where: { key: { in: ['article', 'log', 'portfolio'] } },
  })
  try {
    for (const [key, route] of [
      ['article', '/articles'],
      ['log', '/logs'],
      ['portfolio', '/portfolio'],
    ])
      await prisma.module.upsert({
        where: { key },
        update: { enabled: true, config: { types: { DAILY: true, REPO: true } } },
        create: {
          key,
          name: key,
          route,
          enabled: true,
          config: { types: { DAILY: true, REPO: true } },
        },
      })
    const root = await category(),
      child = await category({ parentId: root.id }),
      unused = await category()
    const visible = await tag(),
      hidden = await tag()
    const add = async (extra: Record<string, unknown>) => {
      const a = await prisma.article.create({
        data: {
          title: '公开',
          slug: `${prefix}-pub-${articles.length}`,
          content: '内容',
          categoryId: child.id,
          status: 'PUBLISHED',
          publishedAt: new Date(Date.now() - 1000),
          tags: { connect: [{ id: visible.id }] },
          ...extra,
        },
      })
      articles.push(a.id)
      return a
    }
    await add({})
    await add({ status: 'DRAFT', tags: { connect: [{ id: hidden.id }] } })
    await add({ publishedAt: new Date(Date.now() + 86400000) })
    await add({ deletedAt: new Date() })
    const l = await prisma.log.create({
      data: {
        title: '公开日志',
        content: '日志',
        logDate: new Date(),
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 1000),
        type: 'DAILY',
        tags: { connect: [{ id: visible.id }] },
      },
    })
    logs.push(l.id)
    // 置顶只放宽记录日期；未来发布时间始终不能进入公开词表。
    const futureLogDate = new Date(new Date(todayLogDate()).getTime() + 2 * 86400000)
    for (const data of [
      { isPinned: false, tagId: hidden.id, publishedAt: new Date(Date.now() - 1000) },
      { isPinned: true, tagId: visible.id, publishedAt: new Date(Date.now() - 1000) },
      { isPinned: true, tagId: visible.id, publishedAt: new Date(Date.now() + 86400000) },
    ]) {
      const future = await prisma.log.create({
        data: {
          title: '未来记录日期',
          content: '公开计数边界',
          logDate: futureLogDate,
          status: 'PUBLISHED',
          type: 'DAILY',
          isPinned: data.isPinned,
          publishedAt: data.publishedAt,
          tags: { connect: [{ id: data.tagId }] },
        },
      })
      logs.push(future.id)
    }
    const p = await prisma.project.create({
      data: {
        title: '公开作品',
        slug: `${prefix}-pub-project`,
        description: '作品',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 1000),
        type: 'REPO',
        tags: { connect: [{ id: visible.id }] },
      },
    })
    projects.push(p.id)
    const nodes = await taxonomy.listPublicCategories()
    const node = nodes.find((n) => n.id === root.id)!
    expect(node).toMatchObject({
      articleCount: 0,
      totalCount: 1,
      children: [{ id: child.id, articleCount: 1, totalCount: 1 }],
    })
    expect(nodes.some((n) => n.id === unused.id)).toBe(false)
    let result = await taxonomy.listPublicTags(new URLSearchParams({ q: visible.slug }))
    expect(result.data[0].counts).toEqual({ article: 1, log: 2, project: 1, total: 4 })
    expect((await taxonomy.listPublicTags(new URLSearchParams({ q: hidden.slug }))).data).toEqual(
      [],
    )
    const admin = await taxonomy.listAdminTags(new URLSearchParams({ q: visible.slug }), req('GET'))
    expect(admin.data[0].counts.article).toBe(3)
    await prisma.module.update({ where: { key: 'article' }, data: { enabled: false } })
    await prisma.module.update({
      where: { key: 'log' },
      data: { config: { types: { DAILY: false } } },
    })
    await prisma.module.update({
      where: { key: 'portfolio' },
      data: { config: { types: { REPO: false } } },
    })
    expect(await taxonomy.listPublicCategories()).toEqual([])
    result = await taxonomy.listPublicTags(new URLSearchParams({ q: visible.slug }))
    expect(result.data).toEqual([])
    await expect(
      taxonomy.listPublicTags(new URLSearchParams({ fields: 'passwordHash' })),
    ).rejects.toMatchObject({ status: 400 })
  } finally {
    for (const row of saved)
      await prisma.module.update({
        where: { key: row.key },
        data: { enabled: row.enabled, config: row.config ?? Prisma.JsonNull },
      })
    for (const key of ['article', 'log', 'portfolio'].filter(
      (k) => !saved.some((m) => m.key === k),
    ))
      await prisma.module.delete({ where: { key } })
  }
})
test('分类更新/合并并发只允许一个CAS成功，审计与派生失效存在', async () => {
  const c = await category()
  const results = await Promise.allSettled([
    taxonomy.updateCategory(c.id, { revision: 1, name: '甲' }, req()),
    taxonomy.updateCategory(c.id, { revision: 1, name: '乙' }, req()),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason).toMatchObject({ status: 409 })
  const a = await tag(),
    b = await tag(),
    body = { target: { id: a.id, revision: 1 }, sources: [{ id: b.id, revision: 1 }] }
  const concurrent = await Promise.allSettled([
    taxonomy.mergeTags(body, req()),
    taxonomy.mergeTags(body, req()),
  ])
  expect(concurrent.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(
    await prisma.auditLog.count({ where: { userId, resource: 'tag', action: 'merge' } }),
  ).toBeGreaterThan(0)
  expect(revalidateTag).toHaveBeenCalledWith('sitemap')
  expect(revalidateTag).toHaveBeenCalledWith('article')
})
test('管理权限矩阵、停用会话、路由400/404/409与no-store', async () => {
  const ids: string[] = []
  try {
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const u = await prisma.user.create({
        data: {
          email: `${prefix}-${role.toLowerCase()}@example.com`,
          name: role,
          passwordHash: await bcrypt.hash('TestPass123', 4),
          role,
        },
      })
      ids.push(u.id)
      const auth = (await login(u.email, 'TestPass123', { ip: `${prefix}-${role}` }, req()))
        .accessToken
      const r = (method = 'GET') =>
        new Request('http://localhost:3000/api/v1/admin/tags', {
          method,
          headers: { authorization: `Bearer ${auth}`, origin: 'http://localhost:3000' },
        })
      await expect(taxonomy.listAdminTags(new URLSearchParams(), r())).resolves.toHaveProperty(
        'data',
      )
      if (role === 'VIEWER')
        await expect(
          taxonomy.createTag({ name: '权限', slug: `${prefix}-viewer` }, r('POST')),
        ).rejects.toMatchObject({ status: 403 })
      else {
        const t = await taxonomy.createTag({ name: '编辑', slug: `${prefix}-editor` }, r('POST'))
        tags.push(t.id)
      }
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false } })
      await expect(taxonomy.listAdminCategories(r())).rejects.toMatchObject({ status: 401 })
    }
    const route = await import('@/app/api/v1/admin/tags/route'),
      single = await import('@/app/api/v1/admin/tags/[id]/route')
    const call = (body: unknown) =>
      new Request('http://localhost:3000/api/v1/admin/tags', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    const created = await route.POST(call({ name: '接口', slug: `${prefix}-route` }))
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const item = (await created.json()).data
    tags.push(item.id)
    expect((await route.POST(call({ name: 'x', slug: 'x', unknown: true }))).status).toBe(400)
    expect((await route.POST(call({ name: 'x', slug: item.slug }))).status).toBe(409)
    expect(
      (await single.GET(req('GET'), { params: Promise.resolve({ id: 'absent' }) })).status,
    ).toBe(404)
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
    await prisma.rateLimit.deleteMany({
      where: { key: { in: ids.map((id) => `adminwrite:${id}`) } },
    })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
})

test('合并与正文写入重叠保持原子性，成功转移后旧正文快照409', async () => {
  const { updateArticle } = await import('@/lib/services/article')
  const target = await tag(),
    source = await tag()
  const article = await prisma.article.create({
    data: {
      title: '并发正文',
      slug: `${prefix}-overlap`,
      content: '原文',
      tags: { connect: [{ id: source.id }] },
    },
  })
  articles.push(article.id)
  const body = { target: { id: target.id, revision: 1 }, sources: [{ id: source.id, revision: 1 }] }
  const result = await Promise.allSettled([
    taxonomy.mergeTags(body, req()),
    updateArticle(article.id, { revision: 1, title: '新版正文' }, req()),
  ])
  const current = await prisma.article.findUniqueOrThrow({
    where: { id: article.id },
    include: { tags: true },
  })
  if (result[0].status === 'fulfilled') {
    expect(await prisma.tag.findUnique({ where: { id: source.id } })).toBeNull()
    expect(current.tags.map((t) => t.id)).toEqual([target.id])
    expect(current.revision).toBe(result[1].status === 'fulfilled' ? 3 : 2)
    await expect(
      updateArticle(article.id, { revision: 1, tagIds: [source.id] }, req()),
    ).rejects.toMatchObject({ status: 409 })
  } else {
    expect(result[0].reason).toMatchObject({ status: 409 })
    expect(await prisma.tag.findUnique({ where: { id: source.id } })).not.toBeNull()
    expect(current.tags.map((t) => t.id)).toEqual([source.id])
    expect((await prisma.tag.findUniqueOrThrow({ where: { id: target.id } })).revision).toBe(1)
  }
})
test('公开分类/标签复用联系信息脱敏且撤销sid无法进入service', async () => {
  const oldProfile = await prisma.profile.findUnique({ where: { id: 'default' } }),
    oldModule = await prisma.module.findUnique({ where: { key: 'article' } })
  try {
    await prisma.profile.upsert({
      where: { id: 'default' },
      create: {
        name: '验收',
        headline: '验收',
        bio: '',
        email: 'private@example.com',
        contactVisible: false,
      },
      update: { email: 'private@example.com', contactVisible: false },
    })
    await prisma.module.upsert({
      where: { key: 'article' },
      create: { key: 'article', name: '文章', route: '/articles', enabled: true },
      update: { enabled: true },
    })
    const c = await category({
        name: 'private@example.com',
        description: 'mailto:private@example.com',
      }),
      t = await taxonomy.createTag(
        { name: 'private@example.com', slug: `${prefix}-private` },
        req(),
      )
    tags.push(t.id)
    const a = await prisma.article.create({
      data: {
        title: '脱敏',
        slug: `${prefix}-private-article`,
        content: '正文',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - 1000),
        categoryId: c.id,
        tags: { connect: [{ id: t.id }] },
      },
    })
    articles.push(a.id)
    expect(JSON.stringify(await taxonomy.listPublicCategories())).not.toContain(
      'private@example.com',
    )
    expect(
      JSON.stringify(await taxonomy.listPublicTags(new URLSearchParams({ q: t.slug }))),
    ).not.toContain('private@example.com')
  } finally {
    if (oldProfile)
      await prisma.profile.update({
        where: { id: 'default' },
        data: { email: oldProfile.email, contactVisible: oldProfile.contactVisible },
      })
    else await prisma.profile.delete({ where: { id: 'default' } })
    if (oldModule)
      await prisma.module.update({
        where: { key: 'article' },
        data: { enabled: oldModule.enabled },
      })
    else await prisma.module.delete({ where: { key: 'article' } })
  }
  const u = await prisma.user.create({
    data: {
      email: `${prefix}-session@example.com`,
      name: '撤销',
      role: 'VIEWER',
      passwordHash: await bcrypt.hash('TestPass123', 4),
    },
  })
  try {
    const credentials = await login(u.email, 'TestPass123', { ip: `${prefix}-session` }, req())
    await prisma.session.updateMany({ where: { userId: u.id }, data: { revokedAt: new Date() } })
    const r = new Request('http://localhost:3000/api/v1/admin/tags', {
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    })
    await expect(taxonomy.listAdminTags(new URLSearchParams(), r)).rejects.toMatchObject({
      status: 401,
    })
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: u.id } })
    await prisma.user.delete({ where: { id: u.id } })
  }
})

test('VIEWER合并预览真实API共用PG写限流，第121次429且不修改词表', async () => {
  const target = await tag(),
    source = await tag()
  const u = await prisma.user.create({
    data: {
      email: `${prefix}-limited@example.com`,
      name: '预览限流',
      role: 'VIEWER',
      passwordHash: await bcrypt.hash('TestPass123', 4),
    },
  })
  const key = `adminwrite:${u.id}`
  try {
    const credentials = await login(u.email, 'TestPass123', { ip: `${prefix}-limited` }, req())
    const route = await import('@/app/api/v1/admin/tags/merge/preview/route')
    const request = (origin = 'http://localhost:3000') =>
      new Request('http://localhost:3000/api/v1/admin/tags/merge/preview', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          origin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          target: { id: target.id, revision: 1 },
          sources: [{ id: source.id, revision: 1 }],
        }),
      })
    await prisma.rateLimit.create({
      data: { key, count: 119, expiresAt: new Date(Date.now() + 900000) },
    })
    expect((await route.POST(request('https://evil.example'))).status).toBe(403)
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(119)
    const allowed = await route.POST(request())
    expect(allowed.status).toBe(200)
    expect((await allowed.json()).data).toMatchObject({
      target: { id: target.id, revision: 1 },
      sources: [{ id: source.id }],
      affected: { total: 0 },
    })
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(120)
    const blocked = await route.POST(request())
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED')
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(121)
    expect(
      await prisma.tag.count({ where: { id: { in: [source.id, target.id] }, revision: 1 } }),
    ).toBe(2)
    expect(await prisma.auditLog.count({ where: { userId: u.id, resource: 'tag' } })).toBe(0)
  } finally {
    await prisma.rateLimit.deleteMany({ where: { key } })
    await prisma.auditLog.deleteMany({ where: { userId: u.id } })
    await prisma.user.delete({ where: { id: u.id } })
  }
})
