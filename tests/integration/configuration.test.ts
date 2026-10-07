import { beforeAll, afterAll, test, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import * as settings from '@/lib/services/settings'
import * as publicSite from '@/lib/services/public-site'
let token: string, userId: string
const req = (method = 'PATCH') =>
  new Request('http://localhost:3000/api/v1/admin/settings', {
    method,
    headers: { origin: 'http://localhost:3000', authorization: `Bearer ${token}` },
  })
beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      name: '公开验收',
      email: `public-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = u.id
  token = (await login(u.email, 'TestPass123', { ip: u.id }, req('POST'))).accessToken
})
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('设置严格组别并嵌套合并motion', async () => {
  expect(settings.updateSettings).toBeTypeOf('function')
  await expect(settings.updateSettings('general', { 'footer.icp': 'x' }, req())).rejects.toThrow()
  await expect(settings.updateSettings('general', { unknown: 'x' }, req())).rejects.toThrow()
  const previous = await prisma.setting.findUniqueOrThrow({ where: { key: 'motion.config' } })
  try {
    await settings.updateSettings(
      'motion',
      { 'motion.config': { reveal: { enabled: false } } },
      req(),
    )
    expect(
      (await prisma.setting.findUniqueOrThrow({ where: { key: 'motion.config' } })).value,
    ).toMatchObject({ version: 2, reveal: { enabled: false, duration: 450 } })
  } finally {
    await prisma.setting.update({ where: { key: previous.key }, data: { value: previous.value! } })
  }
})
test('公开站点白名单与隐藏联系方式，首页过滤未来已删及类型关闭', async () => {
  expect(publicSite.getPublicSite).toBeTypeOf('function')
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: 'default' } })
  const log = await prisma.module.findUniqueOrThrow({ where: { key: 'log' } })
  const socialEmail = await prisma.setting.findUniqueOrThrow({ where: { key: 'social.email' } })
  const ids: string[] = []
  try {
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: false, email: 'private@example.com', phone: '13800138000' },
    })
    await prisma.setting.upsert({
      where: { key: 'social.email' },
      update: { value: 'private@example.com' },
      create: { key: 'social.email', group: 'social', value: 'private@example.com' },
    })
    const site = JSON.stringify(await publicSite.getPublicSite())
    expect(site).not.toContain('private@example.com')
    expect(site).not.toContain('13800138000')
    expect(site).not.toContain('mailto:')
    for (const data of [
      { title: '有效公开', publishedAt: new Date(0) },
      { title: '未来隐藏', publishedAt: new Date('2099-01-01') },
      { title: '已删隐藏', publishedAt: new Date(0), deletedAt: new Date() },
    ]) {
      ids.push(
        (
          await prisma.log.create({
            data: {
              ...data,
              content: '正文',
              logDate: new Date(),
              status: 'PUBLISHED',
              type: 'EVENT',
            },
          })
        ).id,
      )
    }
    await prisma.module.update({
      where: { key: 'log' },
      data: {
        enabled: true,
        config: {
          home: { enabled: true, limit: 20, order: 4 },
          types: { DAILY: true, EVENT: false, SUMMARY: true },
        },
      },
    })
    expect(JSON.stringify(await publicSite.getHomeFeed())).not.toContain('有效公开')
    await prisma.module.update({
      where: { key: 'log' },
      data: {
        config: {
          home: { enabled: true, limit: 20, order: 4 },
          types: { DAILY: true, EVENT: true, SUMMARY: true },
        },
      },
    })
    const home = JSON.stringify(await publicSite.getHomeFeed())
    expect(home).toContain('有效公开')
    expect(home).not.toContain('未来隐藏')
    expect(home).not.toContain('已删隐藏')
  } finally {
    await prisma.log.deleteMany({ where: { id: { in: ids } } })
    await prisma.setting.update({
      where: { key: 'social.email' },
      data: { value: socialEmail.value! },
    })
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: profile.contactVisible, email: profile.email, phone: profile.phone },
    })
    await prisma.module.update({
      where: { key: 'log' },
      data: { enabled: log.enabled, config: log.config! },
    })
  }
})

test('公共隐私过滤保留日期精度和安全social，删除contact链接', async () => {
  const { scrubPublicContacts } = await import('@/lib/services/public-site')
  const result = scrubPublicContacts(
    {
      date: new Date('2026-01-01'),
      email: 'private',
      socials: [{ url: 'mailto:private@example.com' }, { url: 'https://github.com/puly' }],
    },
    ['private@example.com'],
  ) as { date: Date; socials: unknown[] }
  expect(result.date).toBeInstanceOf(Date)
  expect(JSON.stringify(result)).not.toContain('mailto')
  expect(JSON.stringify(result)).toContain('github')
})

test('首页最新文章按发布时间而非置顶排序', async () => {
  const originalModule = await prisma.module.findUniqueOrThrow({ where: { key: 'article' } })
  const ids: string[] = []
  try {
    await prisma.module.update({
      where: { key: 'article' },
      data: { enabled: true, config: { home: { enabled: true, limit: 1, order: 3 } } },
    })
    for (const data of [
      { title: '旧置顶', publishedAt: new Date('2020-01-01'), isTop: true },
      { title: '最新时间', publishedAt: new Date(), isTop: false },
    ])
      ids.push(
        (
          await prisma.article.create({
            data: {
              ...data,
              content: '正文',
              slug: `sort-${Date.now()}-${ids.length}`,
              status: 'PUBLISHED',
            },
          })
        ).id,
      )
    const feed = await publicSite.getHomeFeed()
    const section = feed.sections.find((s) => s.key === 'article')!
    expect(section.items[0]).toMatchObject({ title: '最新时间' })
  } finally {
    await prisma.article.deleteMany({ where: { id: { in: ids } } })
    await prisma.module.update({
      where: { key: 'article' },
      data: { enabled: originalModule.enabled, config: originalModule.config! },
    })
  }
})

test('单区块查询失败不隐藏其他首页内容且错误可见', async () => {
  const spy = vi.spyOn(prisma.article, 'findMany').mockRejectedValueOnce(new Error('单区块失败'))
  try {
    const feed = await publicSite.getHomeFeed()
    expect(feed.errors).toContain('article')
    expect(feed.sections.some((s) => s.key === 'portfolio')).toBe(true)
  } finally {
    spy.mockRestore()
  }
})
test('设置null保存JSON空值，未知生产密钥和内部游标不公开', async () => {
  const old = await prisma.setting.findUnique({ where: { key: 'site.logo' } })
  try {
    await settings.updateSettings('general', { 'site.logo': null }, req())
    expect(
      (await prisma.setting.findUniqueOrThrow({ where: { key: 'site.logo' } })).value,
    ).toBeNull()
    await expect(
      settings.updateSettings('integration', { 'integration.secret': 'secret' }, req()),
    ).rejects.toThrow()
    expect(JSON.stringify(await publicSite.getPublicSite())).not.toContain(
      'jobs.publication.cursor',
    )
    expect(JSON.stringify(await settings.listSettings(req('GET')))).not.toContain(
      'jobs.publication.cursor',
    )
  } finally {
    if (old) await prisma.setting.update({ where: { key: old.key }, data: { value: old.value! } })
  }
})

test('首页作品只选精选，时间线保留精度并按当前项排序', async () => {
  const snapshots = await prisma.module.findMany({
    where: { key: { in: ['portfolio', 'timeline'] } },
  })
  const ids: string[] = []
  const tids: string[] = []
  try {
    for (const m of snapshots)
      await prisma.module.update({
        where: { key: m.key },
        data: {
          enabled: true,
          config: { home: { enabled: true, limit: 20, order: m.key === 'portfolio' ? 2 : 5 } },
        },
      })
    for (const data of [
      { title: '精选有效', featured: true },
      { title: '非精选隐藏', featured: false },
    ])
      ids.push(
        (
          await prisma.project.create({
            data: {
              ...data,
              slug: `featured-${Date.now()}-${ids.length}`,
              description: '描述',
              type: 'REPO',
              status: 'PUBLISHED',
              publishedAt: new Date(0),
            },
          })
        ).id,
      )
    for (const data of [
      { title: '当前精度', isCurrent: true, startPrecision: 'YEAR' as const },
      {
        title: '已删时间线',
        isCurrent: false,
        startPrecision: 'MONTH' as const,
        deletedAt: new Date(),
      },
    ])
      tids.push(
        (
          await prisma.timelineItem.create({
            data: { ...data, type: 'WORK', startDate: new Date() },
          })
        ).id,
      )
    const home = await publicSite.getHomeFeed()
    expect(JSON.stringify(home)).toContain('精选有效')
    expect(JSON.stringify(home)).not.toContain('非精选隐藏')
    expect(JSON.stringify(home)).not.toContain('已删时间线')
    const timeline = home.sections.find((s) => s.key === 'timeline')!
    expect(timeline.items[0]).toMatchObject({ title: '当前精度', startPrecision: 'YEAR' })
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: ids } } })
    await prisma.timelineItem.deleteMany({ where: { id: { in: tids } } })
    for (const m of snapshots)
      await prisma.module.update({
        where: { key: m.key },
        data: { enabled: m.enabled, config: m.config! },
      })
  }
})

test('公开文章DTO同样清除本人联系方式', async () => {
  const { getPublicArticle, listPublicArticles } = await import('@/lib/services/article')
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: 'default' } })
  let id = ''
  try {
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: false, email: 'dto-private@example.com', phone: '13800138000' },
    })
    const article = await prisma.article.create({
      data: {
        title: '私密DTO',
        slug: `privacy-${Date.now()}`,
        summary: '联系 dto-private@example.com',
        content: '正文 [联系](mailto:dto-private@example.com) 13800138000',
        status: 'PUBLISHED',
        publishedAt: new Date(0),
      },
    })
    id = article.id
    expect(JSON.stringify(await getPublicArticle(article.slug))).not.toContain(
      'dto-private@example.com',
    )
    expect(JSON.stringify(await listPublicArticles())).not.toContain('dto-private@example.com')
  } finally {
    if (id) await prisma.article.delete({ where: { id } })
    await prisma.profile.update({
      where: { id: 'default' },
      data: { contactVisible: profile.contactVisible, email: profile.email, phone: profile.phone },
    })
  }
})

test('隐私检测实体百分号混合编码并保留必填正文类型', async () => {
  const blocked = ['hi@example.com', '13800138000']
  const value = {
    title: '标题 h&#105;@example.com 后文',
    content: '正文 [联系](ma&#105;lto:h%69%40example.com) 结尾 13800&#49;38000',
    seoTitle: 'h&Tab;i@example.com',
    url: 'https://example.com/?contact=h%69%40example.com',
    safe: '普通正文',
    socials: [{ url: 'mailto:h%69%40example.com' }],
  }
  const result = publicSite.scrubPublicContacts(value, blocked) as typeof value
  const normalized = JSON.stringify(result)
  expect(normalized).not.toContain('&#105;')
  expect(normalized).not.toContain('h%69%40')
  expect(normalized).not.toContain('13800')
  expect(result.content).toBeTypeOf('string')
  expect(result.title).toContain('标题')
  expect(result.safe).toBe('普通正文')
  const leading = publicSite.scrubPublicContacts(
    { content: 'https://example.com/?email=hi@example.com' },
    blocked,
  ) as { content: string }
  expect(leading.content).toBeTypeOf('string')
})
