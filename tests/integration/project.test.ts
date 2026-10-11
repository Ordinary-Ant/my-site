import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import { revalidateTag } from 'next/cache'
import * as publicRoute from '@/app/api/v1/projects/route'
import * as createRoute from '@/app/api/v1/admin/projects/route'
import * as editRoute from '@/app/api/v1/admin/projects/[id]/route'
import {
  createProject,
  updateProject,
  deleteProject,
  restoreProject,
  purgeProject,
  listPublicProjects,
  getPublicProject,
  listAdminProjects,
  bulkProjects,
  reorderProjects,
  getProjectOptions,
  projectSlugAvailable,
  createProjectPreviewToken,
  getPreviewProject,
} from '@/lib/services/project'

let userId: string, token: string
const ids: string[] = [],
  tagIds: string[] = []
let savedModule: { enabled: boolean; config: Prisma.JsonValue } | null
const prefix = `project-${Date.now()}`
const request = (origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/v1/admin/projects', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin },
  })
const make = async (extra: Record<string, unknown> = {}) => {
  const item = await createProject(
    { title: prefix, slug: `${prefix}-${ids.length}`, description: '解决问题', ...extra },
    request(),
  )
  ids.push(item.id)
  return item
}
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: '作品验收',
      email: `${prefix}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: prefix }, request())).accessToken
  savedModule = await prisma.module.findUnique({
    where: { key: 'portfolio' },
    select: { enabled: true, config: true },
  })
  await prisma.module.upsert({
    where: { key: 'portfolio' },
    update: {
      enabled: true,
      config: { pageSize: 3, types: { GAME: true, REPO: true, SKILL: true, OTHER: true } },
    },
    create: { key: 'portfolio', name: '作品', route: '/portfolio' },
  })
})
afterAll(async () => {
  await prisma.previewToken.deleteMany({ where: { contentId: { in: ids }, kind: 'project' } })
  await prisma.project.deleteMany({ where: { id: { in: ids } } })
  await prisma.tag.deleteMany({ where: { id: { in: tagIds } } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.rateLimit.deleteMany({ where: { key: `adminwrite:${userId}` } })
  await prisma.user.delete({ where: { id: userId } })
  if (savedModule)
    await prisma.module.update({
      where: { key: 'portfolio' },
      data: { enabled: savedModule.enabled, config: savedModule.config ?? Prisma.JsonNull },
    })
  await prisma.$disconnect()
})
test('轻量作品真实创建默认发布且列表不含正文、首图默认封面', async () => {
  const item = await make({
    links: { demo: 'https://example.com' },
    gallery: ['/uploads/first.png'],
    featured: true,
    techStack: ['UniqueTech'],
    startDate: '2024-01-01',
  })
  expect(item.content).toBeNull()
  expect(item.publishedAt).toBeInstanceOf(Date)
  expect(item.coverImage).toBe('/uploads/first.png')
  const result = await listPublicProjects(
    new URLSearchParams({ q: prefix, tech: 'UniqueTech', featured: 'true' }),
  )
  expect(result.data.map((x) => x.id)).toEqual([item.id])
  expect(result.data[0]).not.toHaveProperty('content')
  expect(result.data[0]).not.toHaveProperty('deletedAt')
  expect(result.meta.pageSize).toBe(3)
  expect((await getPublicProject(item.slug)).id).toBe(item.id)
  expect((await getProjectOptions(request())).techStack).toContain('UniqueTech')
})
test('typeCounts忽略选中类型，状态/时刻/删除/类型关闭过滤一致', async () => {
  const name = `${prefix}-counts`
  const game = await make({ title: name, type: 'GAME' })
  await make({ title: name, type: 'SKILL' })
  const draft = await make({ title: name, type: 'GAME', status: 'DRAFT' })
  const future = await make({ title: name, type: 'GAME', publishedAt: '2099-01-01' })
  const deleted = await make({ title: name, type: 'GAME' })
  await deleteProject(deleted.id, 1, request())
  for (const item of [draft, future, deleted])
    await expect(getPublicProject(item.slug)).rejects.toMatchObject({ status: 404 })
  const result = await listPublicProjects(new URLSearchParams({ q: name, type: 'GAME' }))
  expect(result.data.map((x) => x.id)).toEqual([game.id])
  expect(result.meta.typeCounts).toEqual({ GAME: 1, REPO: 0, SKILL: 1, OTHER: 0 })
  await prisma.module.update({
    where: { key: 'portfolio' },
    data: { config: { types: { GAME: false } } },
  })
  expect((await listPublicProjects(new URLSearchParams({ q: name }))).meta.typeCounts.GAME).toBe(0)
  await expect(getPublicProject(game.slug)).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({ where: { key: 'portfolio' }, data: { enabled: false } })
  const off = await listPublicProjects()
  expect(off.data).toEqual([])
  expect(off.meta.total).toBe(0)
  await prisma.module.update({
    where: { key: 'portfolio' },
    data: { enabled: true, config: { pageSize: 3 } },
  })
})
test('null和空数组清空，gallery更新不覆盖明确封面，合并日期重新验证', async () => {
  const item = await make({
    startDate: '2024-03-01',
    endDate: '2024-04-01',
    content: '正文',
    links: { demo: 'https://example.com' },
    gallery: ['/uploads/a.png'],
    techStack: ['React'],
    highlights: ['量化成果'],
  })
  await expect(
    updateProject(item.id, { revision: 1, endDate: '2024-02-01' }, request()),
  ).rejects.toMatchObject({ status: 400 })
  const changed = await updateProject(
    item.id,
    {
      revision: 1,
      content: null,
      links: null,
      coverImage: null,
      gallery: [],
      techStack: [],
      highlights: [],
      tagIds: [],
      startDate: null,
      endDate: null,
    },
    request(),
  )
  expect(changed).toMatchObject({
    content: null,
    links: null,
    coverImage: null,
    gallery: [],
    techStack: [],
    highlights: [],
    tags: [],
    startDate: null,
    endDate: null,
  })
  const updated = await updateProject(
    item.id,
    { revision: 2, gallery: ['/uploads/new.png'] },
    request(),
  )
  expect(updated.coverImage).toBeNull()
})
test('同revision并发仅一次成功，重复slug安全冲突且关系失败回滚', async () => {
  const item = await make()
  const outcomes = await Promise.allSettled([
    updateProject(item.id, { revision: 1, title: '甲' }, request()),
    updateProject(item.id, { revision: 1, title: '乙' }, request()),
  ])
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(
    (outcomes.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason,
  ).toMatchObject({ status: 409 })
  await expect(
    createProject({ title: '重复', slug: item.slug, description: '说明' }, request()),
  ).rejects.toMatchObject({ code: 'P2002' })
  expect(await projectSlugAvailable(item.slug, null, request())).toEqual({ available: false })
  expect(await projectSlugAvailable(item.slug, item.id, request())).toEqual({ available: true })
  await expect(
    updateProject(
      item.id,
      { revision: 2, title: '应回滚', tagIds: ['cm000000000000000000000000'] },
      request(),
    ),
  ).rejects.toBeTruthy()
  const unchanged = await prisma.project.findUniqueOrThrow({ where: { id: item.id } })
  expect(unchanged.revision).toBe(2)
  expect(unchanged.title).not.toBe('应回滚')
})
test('公开日期闭区间使用上海日期，ISO按时刻；字段和排序严格白名单', async () => {
  const name = `${prefix}-dates`
  const early = await make({ title: name, startDate: '2024-02-28T16:00:00Z' })
  const late = await make({ title: name, startDate: '2024-02-29T15:59:59.999Z' })
  await make({ title: name, startDate: '2024-02-29T16:00:00Z' })
  const result = await listPublicProjects(
    new URLSearchParams({
      q: name,
      from: '2024-02-29',
      to: '2024-02-29',
      fields: 'id,title',
      sort: 'latest',
    }),
  )
  expect(result.data.map((x) => x.id)).toEqual([late.id, early.id])
  expect(Object.keys(result.data[0])).toEqual(['id', 'title'])
  expect(
    (
      await listPublicProjects(
        new URLSearchParams({
          q: name,
          from: '2024-02-29T15:59:59.999Z',
          to: '2024-02-29T15:59:59.999Z',
        }),
      )
    ).data.map((x) => x.id),
  ).toEqual([late.id])
  for (const query of [
    { from: '2023-02-29' },
    { from: '2024-03-01', to: '2024-02-01' },
    { fields: 'content' },
    { fields: 'deletedAt' },
    { sort: 'links' },
  ] as Record<string, string>[])
    await expect(listPublicProjects(new URLSearchParams(query))).rejects.toBeTruthy()
})
test('固定排序含NULL最后与id决胜，上下篇使用相同公开过滤', async () => {
  const name = `${prefix}-order`
  const a = await make({ title: name, order: 900000, startDate: '2024-01-01' })
  const b = await make({ title: name, order: 900000, startDate: '2024-01-01' })
  const c = await make({ title: name, order: 900000, startDate: null })
  const draft = await make({ title: name, order: 900000, startDate: '2024-01-01', status: 'DRAFT' })
  const sorted = [a, b].sort((x, y) => x.id.localeCompare(y.id))
  expect(
    (await listPublicProjects(new URLSearchParams({ q: name }))).data.map((x) => x.id),
  ).toEqual([...sorted.map((x) => x.id), c.id])
  expect((await getPublicProject(sorted[0].slug)).next?.id).toBe(sorted[1].id)
  expect((await getPublicProject(sorted[1].slug)).next?.id).toBe(c.id)
  expect((await getPublicProject(c.slug)).prev?.id).toBe(sorted[1].id)
  await expect(getPublicProject(draft.slug)).rejects.toMatchObject({ status: 404 })
})
test('排序全事务CAS失败不部分写，成功审计与缓存失效', async () => {
  const a = await make(),
    b = await make()
  await expect(
    reorderProjects(
      {
        items: [
          { id: a.id, order: 12, revision: 1 },
          { id: b.id, order: 13, revision: 99 },
        ],
      },
      request(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  expect((await prisma.project.findUniqueOrThrow({ where: { id: a.id } })).order).toBe(0)
  const result = await reorderProjects(
    {
      items: [
        { id: b.id, order: 13, revision: 1 },
        { id: a.id, order: 12, revision: 1 },
      ],
    },
    request(),
  )
  expect(result.items.map((x) => x.revision)).toEqual([2, 2])
  expect(
    await prisma.auditLog.count({
      where: { resource: 'project', resourceId: { in: [a.id, b.id] }, action: 'reorder' },
    }),
  ).toBe(2)
})
test('批量逐项CAS/标签增减/部分结果/审计实际变化', async () => {
  const a = await make({ status: 'DRAFT' }),
    b = await make({ status: 'DRAFT' })
  expect(
    await bulkProjects(
      { ids: [a.id, b.id], revisions: { [a.id]: 1, [b.id]: 99 }, action: 'publish' },
      request(),
    ),
  ).toMatchObject({ succeeded: [a.id], failed: [{ id: b.id, code: 'REVISION_CONFLICT' }] })
  const tag = await prisma.tag.create({ data: { name: prefix, slug: prefix } })
  tagIds.push(tag.id)
  await bulkProjects(
    { ids: [a.id], revisions: { [a.id]: 2 }, action: 'addTags', payload: { tagIds: [tag.id] } },
    request(),
  )
  expect(
    (await listPublicProjects(new URLSearchParams({ tag: tag.slug }))).data.map((x) => x.id),
  ).toContain(a.id)
  await bulkProjects(
    { ids: [a.id], revisions: { [a.id]: 3 }, action: 'removeTags', payload: { tagIds: [tag.id] } },
    request(),
  )
  expect(
    (await prisma.project.findUniqueOrThrow({ where: { id: a.id }, include: { tags: true } })).tags,
  ).toEqual([])
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { resourceId: a.id, action: 'removeTags' },
  })
  expect(audit.before).toMatchObject({ tagIds: [tag.id] })
  expect(audit.after).toMatchObject({ tagIds: [] })
})
test('回收站/恢复/purge要求revision且仅ADMIN彻底删除', async () => {
  const item = await make()
  const deleted = await deleteProject(item.id, 1, request())
  expect(
    (
      await listAdminProjects(
        new URLSearchParams({ includeDeleted: 'true', status: 'PUBLISHED,DRAFT' }),
        request(),
      )
    ).data.map((x) => x.id),
  ).toContain(item.id)
  await expect(restoreProject(item.id, 1, request())).rejects.toMatchObject({ status: 409 })
  const restored = await restoreProject(item.id, deleted.revision, request())
  await deleteProject(item.id, restored.revision, request())
  await prisma.user.update({ where: { id: userId }, data: { role: 'EDITOR' } })
  await expect(purgeProject(item.id, 4, request())).rejects.toMatchObject({ status: 403 })
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
  await expect(purgeProject(item.id, 3, request())).rejects.toMatchObject({ status: 409 })
  await purgeProject(item.id, 4, request())
  expect(await prisma.project.findUnique({ where: { id: item.id } })).toBeNull()
})
test('预览24h摘要/类型草稿可读，过期关闭软删拒绝，VIEWER共享限流Origin', async () => {
  const item = await make({ type: 'GAME', status: 'DRAFT' })
  await prisma.module.update({
    where: { key: 'portfolio' },
    data: { config: { types: { GAME: false } } },
  })
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  await expect(
    createProjectPreviewToken(item.id, request('https://evil.example')),
  ).rejects.toMatchObject({ status: 403 })
  const preview = await createProjectPreviewToken(item.id, request())
  expect(preview.expiresAt.getTime() - Date.now()).toBeGreaterThan(86390000)
  expect((await getPreviewProject(preview.token)).id).toBe(item.id)
  const hash = createHash('sha256').update(preview.token).digest('hex')
  expect(await prisma.previewToken.findUnique({ where: { hash: preview.token } })).toBeNull()
  await prisma.previewToken.update({ where: { hash }, data: { expiresAt: new Date(0) } })
  await expect(getPreviewProject(preview.token)).rejects.toMatchObject({ status: 404 })
  await prisma.rateLimit.upsert({
    where: { key: `adminwrite:${userId}` },
    update: { count: 120, expiresAt: new Date(Date.now() + 900000) },
    create: { key: `adminwrite:${userId}`, count: 120, expiresAt: new Date(Date.now() + 900000) },
  })
  await expect(createProjectPreviewToken(item.id, request())).rejects.toMatchObject({ status: 429 })
  await prisma.rateLimit.deleteMany({ where: { key: `adminwrite:${userId}` } })
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
  const valid = await createProjectPreviewToken(item.id, request())
  await deleteProject(item.id, 1, request())
  await expect(getPreviewProject(valid.token)).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({ where: { key: 'portfolio' }, data: { enabled: false } })
  await expect(getPreviewProject(valid.token)).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({
    where: { key: 'portfolio' },
    data: { enabled: true, config: { pageSize: 3 } },
  })
})
test('相反锁顺序并发重排不死锁，同revision仅一事务成功', async () => {
  const a = await make(),
    b = await make()
  const results = await Promise.allSettled([
    reorderProjects(
      {
        items: [
          { id: a.id, order: 22, revision: 1 },
          { id: b.id, order: 23, revision: 1 },
        ],
      },
      request(),
    ),
    reorderProjects(
      {
        items: [
          { id: b.id, order: 33, revision: 1 },
          { id: a.id, order: 32, revision: 1 },
        ],
      },
      request(),
    ),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(
    (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
  ).toMatchObject({ status: 409 })
  const rows = await prisma.project.findMany({
    where: { id: { in: [a.id, b.id] } },
    orderBy: { order: 'asc' },
  })
  expect(rows.map((row) => row.revision)).toEqual([2, 2])
  expect(rows[1].order - rows[0].order).toBe(1)
  for (const tag of ['project', 'content', 'home', 'search', 'rss', 'sitemap', 'stats'])
    expect(revalidateTag).toHaveBeenCalledWith(tag)
})
test('不变字段不写审计，缺失标签批量失败且revision和正文回滚', async () => {
  const item = await make()
  await updateProject(
    item.id,
    { revision: 1, title: item.title, description: '真实变化' },
    request(),
  )
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { resource: 'project', resourceId: item.id, action: 'update' },
  })
  expect(audit.before).not.toHaveProperty('title')
  expect(audit.after).toMatchObject({ description: '真实变化', revision: 2 })
  const result = await bulkProjects(
    {
      ids: [item.id],
      revisions: { [item.id]: 2 },
      action: 'addTags',
      payload: { tagIds: ['cmissingtag000000000000000'] },
    },
    request(),
  )
  expect(result).toMatchObject({ succeeded: [], failed: [{ id: item.id, code: 'NOT_FOUND' }] })
  expect((await prisma.project.findUniqueOrThrow({ where: { id: item.id } })).revision).toBe(2)
})
test('公开DTO隐私清理覆盖全部卡片/长文/链接/邻接字段且先于fields投影', async () => {
  const saved = await prisma.profile.findUnique({ where: { id: 'default' } })
  const email = `${prefix}-hidden@example.com`,
    phone = '13800138888'
  try {
    await prisma.profile.upsert({
      where: { id: 'default' },
      create: { name: '隐私', headline: '验收', bio: '', email, phone, contactVisible: false },
      update: { email, phone, contactVisible: false },
    })
    const item = await make({
      title: `${prefix}-privacy ${email}`,
      subtitle: phone,
      description: `联系 ${email} ${phone}`,
      content: `mailto:${email} tel:${phone}`,
      techStack: [email],
      highlights: [phone],
      role: email,
      links: { demo: `https://example.com/?contact=${email}` },
    })
    const next = await make({ title: `${email} ${phone}`, order: item.order, startDate: null })
    const detail = await getPublicProject(item.slug)
    const list = await listPublicProjects(
      new URLSearchParams({
        q: `${prefix}-privacy`,
        fields: 'id,title,description,links,techStack,highlights',
      }),
    )
    const json = JSON.stringify({ detail, list })
    for (const contact of [email, phone, 'mailto:', 'tel:']) expect(json).not.toContain(contact)
    expect(detail.next?.id).toBe(next.id)
    expect(Object.keys(list.data[0])).toEqual([
      'id',
      'title',
      'description',
      'links',
      'techStack',
      'highlights',
    ])
    expect(list.meta.total).toBe(1)
  } finally {
    if (saved)
      await prisma.profile.update({
        where: { id: saved.id },
        data: { email: saved.email, phone: saved.phone, contactVisible: saved.contactVisible },
      })
    else await prisma.profile.delete({ where: { id: 'default' } })
  }
})
test('真实HTTP handler创建201/重复slug409与字段错误/公开meta保持', async () => {
  const body = { title: `${prefix}-http`, slug: `${prefix}-http`, description: 'HTTP验收' }
  const post = (value: unknown) =>
    new Request('http://localhost:3000/api/v1/admin/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify(value),
    })
  const created = await createRoute.POST(post(body))
  expect(created.status).toBe(201)
  const item = (await created.json()).data
  ids.push(item.id)
  expect(item.publishedAt).toMatch(/^\d{4}-/)
  const duplicate = await createRoute.POST(post(body))
  expect(duplicate.status).toBe(409)
  expect((await duplicate.json()).error.details).toContainEqual({
    path: 'slug',
    message: '字段值已存在',
  })
  const invalid = await createRoute.POST(
    post({ ...body, slug: `${body.slug}-invalid`, links: { demo: 'javascript:x' } }),
  )
  expect(invalid.status).toBe(400)
  expect((await invalid.json()).error.details).toContainEqual(
    expect.objectContaining({ path: 'links.demo' }),
  )
  const stale = await editRoute.PATCH(
    new Request(`http://localhost:3000/api/v1/admin/projects/${item.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ revision: 99, title: '过期' }),
    }),
    { params: Promise.resolve({ id: item.id }) },
  )
  expect(stale.status).toBe(409)
  expect((await stale.json()).error.code).toBe('REVISION_CONFLICT')
  const response = await publicRoute.GET(
    new Request(`http://localhost:3000/api/v1/projects?q=${body.title}&fields=id,title`),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    data: [{ id: item.id, title: body.title }],
    meta: { total: 1, typeCounts: { REPO: 1 } },
  })
})
test('缺失标签HTTP POST返回404且不创建作品', async () => {
  const slug = `${prefix}-missing-tag-create`
  const response = await createRoute.POST(
    new Request('http://localhost:3000/api/v1/admin/projects', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: '缺失标签',
        slug,
        description: '应整体回滚',
        tagIds: ['cmissingtag000000000000000'],
      }),
    }),
  )
  expect(response.status).toBe(404)
  expect((await response.json()).error.code).toBe('NOT_FOUND')
  expect(await prisma.project.findUnique({ where: { slug } })).toBeNull()
})
test('缺失标签HTTP PATCH返回404且内容关系revision审计回滚', async () => {
  const tag = await prisma.tag.create({
    data: { name: '原有标签', slug: `${prefix}-original-tag` },
  })
  tagIds.push(tag.id)
  const item = await make({ tagIds: [tag.id] })
  const response = await editRoute.PATCH(
    new Request(`http://localhost:3000/api/v1/admin/projects/${item.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        revision: item.revision,
        title: '不应保存',
        tagIds: ['cmissingtag000000000000000'],
      }),
    }),
    { params: Promise.resolve({ id: item.id }) },
  )
  expect(response.status).toBe(404)
  expect((await response.json()).error.code).toBe('NOT_FOUND')
  const unchanged = await prisma.project.findUniqueOrThrow({
    where: { id: item.id },
    include: { tags: true },
  })
  expect(unchanged).toMatchObject({ title: item.title, revision: item.revision })
  expect(unchanged.tags.map((value) => value.id)).toEqual([tag.id])
  expect(
    await prisma.auditLog.count({
      where: { resource: 'project', resourceId: item.id, action: 'update' },
    }),
  ).toBe(0)
})
test('原生表单sort空值使用默认排序，公开HTTP返回200', async () => {
  const title = `${prefix}-empty-sort`
  const later = await make({ title, order: 2, startDate: '2024-06-01' })
  const earlier = await make({ title, order: 1, startDate: '2024-01-01' })
  const params = new URLSearchParams({ q: title, sort: '' })
  const result = await listPublicProjects(params)
  expect(result.data.map((item) => item.id)).toEqual([earlier.id, later.id])
  params.delete('sort')
  expect(result).toEqual(await listPublicProjects(params))
  const response = await publicRoute.GET(
    new Request(`http://localhost:3000/api/v1/projects?q=${title}&sort=`),
  )
  expect(response.status).toBe(200)
  expect((await response.json()).data.map((item: { id: string }) => item.id)).toEqual([
    earlier.id,
    later.id,
  ])
})
test('服务权威角色与启用账号/会话检查，每次数据入口不可绕过', async () => {
  const item = await make()
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  expect((await listAdminProjects(new URLSearchParams(), request())).data.length).toBeGreaterThan(0)
  await expect(
    updateProject(item.id, { revision: 1, title: '越权' }, request()),
  ).rejects.toMatchObject({ status: 403 })
  await expect(
    reorderProjects({ items: [{ id: item.id, revision: 1, order: 2 }] }, request()),
  ).rejects.toMatchObject({ status: 403 })
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: false } })
  await expect(getProjectOptions(request())).rejects.toMatchObject({ status: 401 })
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
  await expect(projectSlugAvailable(item.slug, null, request())).rejects.toMatchObject({
    status: 401,
  })
})
