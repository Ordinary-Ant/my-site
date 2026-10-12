import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

test('搜索归档与SEO公共出口、匿名阅读上报形成真实闭环', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '业务闭环仅桌面，布局三端独立验证')
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('拒绝操作非测试库')
  const db = new PrismaClient({ datasources: { db: { url } } }),
    run = 'seo-browser-' + randomUUID()
  const modules = await db.module.findMany({
    where: { key: { in: ['article', 'log', 'portfolio'] } },
  })
  let category = '',
    tag = '',
    article = '',
    draft = '',
    log = '',
    project = ''
  let legacyAliasCreated = false
  const contexts = []
  try {
    expect(
      (await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
    ).toMatch(/_test$/)
    await db.rateLimit.deleteMany({ where: { key: 'public:unknown' } })
    for (const m of modules)
      await db.module.update({ where: { key: m.key }, data: { enabled: true, config: {} } })
    category = (await db.category.create({ data: { name: '搜索验收分类', slug: run } })).id
    tag = (await db.tag.create({ data: { name: '搜索验收标签', slug: run } })).id
    article = (
      await db.article.create({
        data: {
          slug: run,
          title: run + ' 文章',
          summary: '真实搜索摘要',
          content: '## 标题\n' + run + ' 搜索正文',
          status: 'PUBLISHED',
          publishedAt: new Date('2020-01-01'),
          categoryId: category,
          tags: { connect: { id: tag } },
        },
      })
    ).id
    draft = (
      await db.article.create({
        data: { slug: run + '-draft', title: run + ' 草稿', content: '私有', status: 'DRAFT' },
      })
    ).id
    log = (
      await db.log.create({
        data: {
          title: run + ' 日志',
          content: run + ' 日志正文',
          logDate: new Date('2020-01-01'),
          publishedAt: new Date('2021-01-01'),
          status: 'PUBLISHED',
        },
      })
    ).id
    project = (
      await db.project.create({
        data: {
          slug: run,
          title: run + ' 作品',
          description: run + ' 作品摘要',
          status: 'PUBLISHED',
          publishedAt: new Date('2022-01-01'),
        },
      })
    ).id
    await page.goto('/search')
    await page.getByRole('search').getByRole('textbox').fill(run)
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText('找到 3 条内容', { exact: true })).toBeVisible()
    await expect(page.locator('main article h2').first()).toContainText('作品')
    await expect(page.locator('mark').first()).toHaveText(run)
    await page
      .getByRole('navigation', { name: '搜索类型' })
      .getByRole('link', { name: '文章 1', exact: true })
      .click()
    await expect(page.locator('main article')).toHaveCount(1)
    await page.locator('main article h2 a').click()
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      testBaseURL + modules.find((m) => m.key === 'article')!.route + '/' + run,
    )
    // 无JS也必须在head读到完整元数据，不能依赖水合移动流式标签。
    const metadataContext = await browser.newContext({ javaScriptEnabled: false })
    contexts.push(metadataContext)
    const metadataPage = await metadataContext.newPage()
    for (let attempt = 0; attempt < 3; attempt++) {
      await metadataPage.goto(
        testBaseURL + modules.find((m) => m.key === 'article')!.route + '/' + run,
      )
      await expect(metadataPage.locator('head meta[name="description"]')).toHaveAttribute(
        'content',
        '真实搜索摘要',
      )
      await expect(metadataPage.locator('head link[rel="canonical"]')).toHaveAttribute(
        'href',
        testBaseURL + modules.find((m) => m.key === 'article')!.route + '/' + run,
      )
    }
    await page.getByRole('link', { name: '搜索验收分类', exact: true }).click()
    await expect(page.locator('h1')).toHaveText('搜索验收分类')
    expect((await page.request.get('/rss.xml')).headers()['cache-control']).toContain('no-store')
    const rss = await (await page.request.get('/rss.xml')).text()
    expect(rss).toContain('article:' + article)
    expect(rss).not.toContain(run + '-draft')
    const sitemap = await (await page.request.get('/sitemap.xml')).text()
    expect(sitemap).toContain('/category/' + run)
    expect(sitemap).toContain('/tag/' + run)
    expect(sitemap).not.toContain(run + '-draft')
    const robots = await (await page.request.get('/robots.txt')).text()
    expect(robots).toContain('Disallow: /preview')
    expect(robots).toContain('Allow: /api/v1/og')
    // D阶段允许/og作为栏目或别名，升级后的图片端点不能抢占旧地址。
    await db.routeAlias.create({ data: { path: '/og', moduleKey: 'article' } })
    legacyAliasCreated = true
    const og = await page.request.get('/api/v1/og?resource=article&id=' + run)
    expect(og.status()).toBe(200)
    expect(og.headers()['content-type']).toContain('image/png')
    const legacy = await page.request.get('/og/' + run + '?keep=1', { maxRedirects: 0 })
    expect(legacy.status()).toBe(301)
    expect(new URL(legacy.headers().location, testBaseURL).pathname).toBe(
      modules.find((m) => m.key === 'article')!.route + '/' + run,
    )
    await db.routeAlias.delete({ where: { path: '/og' } })
    legacyAliasCreated = false
    const articleRoute = modules.find((m) => m.key === 'article')!.route
    await db.module.update({ where: { key: 'article' }, data: { route: '/og' } })
    expect((await page.request.get('/og/' + run)).status()).toBe(200)
    const during = await page.request.get('/api/v1/og?resource=article&id=' + run)
    expect(during.headers()['content-type']).toContain('image/png')
    await db.module.update({ where: { key: 'article' }, data: { route: articleRoute } })

    expect(
      (await page.request.get('/api/v1/og?resource=article&id=' + run + '-draft')).status(),
    ).toBe(404)

    // 各栏目结构化数据与日志无阅读量展示合同都由真实页面验证。
    for (const m of modules.filter((m) => m.key !== 'article')) {
      const html = await (await page.request.get(m.route)).text()
      expect(html).toContain('CollectionPage')
    }
    const timeline = await db.module.findUniqueOrThrow({ where: { key: 'timeline' } })
    if (timeline.enabled)
      expect(await (await page.request.get(timeline.route)).text()).toContain('BreadcrumbList')
    const logRoute = modules.find((m) => m.key === 'log')!.route
    await page.goto(logRoute + '/' + log)
    await expect(page.getByLabel('阅读量')).toHaveCount(0)

    const initialViews = (await db.article.findUniqueOrThrow({ where: { id: article } })).viewCount
    const reader = await browser.newContext({
      baseURL: testBaseURL,
      userAgent: 'Mozilla/5.0 E2EReader',
    })
    contexts.push(reader)
    const headers = { Origin: testBaseURL }
    const report = await reader.request.post('/api/v1/views', {
      headers,
      data: { resource: 'article', id: article },
    })
    expect(report.status()).toBe(200)
    expect((await report.json()).data.counted).toBe(true)
    expect(report.headers()['set-cookie']).toContain('HttpOnly')
    const parallel = await Promise.all(
      Array.from({ length: 6 }, () =>
        reader.request.post('/api/v1/views', {
          headers,
          data: { resource: 'article', id: article },
        }),
      ),
    )
    for (const result of parallel) expect((await result.json()).data.counted).toBe(false)
    expect(
      (
        await reader.request.post('/api/v1/views', {
          headers: { Origin: 'https://evil.test' },
          data: { resource: 'article', id: article },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await reader.request.post('/api/v1/views', {
          headers,
          data: { resource: 'article', id: article, count: 99 },
        })
      ).status(),
    ).toBe(400)
    expect(
      (
        await reader.request.post('/api/v1/views', {
          headers,
          data: { resource: 'article', id: draft },
        })
      ).status(),
    ).toBe(404)
    const readerPage = await reader.newPage()
    const route = modules.find((m) => m.key === 'article')!.route
    await readerPage.goto(route + '/' + run)
    await expect(readerPage.getByLabel('阅读量')).toHaveText(initialViews + 1 + ' 次阅读')
    expect((await db.article.findUniqueOrThrow({ where: { id: article } })).viewCount).toBe(
      initialViews + 1,
    )
    const previewToken = randomUUID()
    await db.previewToken.create({
      data: {
        hash: createHash('sha256').update(previewToken).digest('hex'),
        kind: 'article',
        contentId: draft,
        expiresAt: new Date(Date.now() + 3600000),
      },
    })
    const preview = await page.request.get('/preview/' + previewToken)
    expect(preview.status()).toBe(200)
    expect(preview.headers()['x-robots-tag']).toContain('noindex')
    expect(await preview.text()).not.toContain('aria-label="阅读量"')
    await db.previewToken.delete({
      where: { hash: createHash('sha256').update(previewToken).digest('hex') },
    })

    const old = '/old-' + run,
      next = '/new-' + run
    await db.routeAlias.create({ data: { path: old, moduleKey: 'article' } })
    await db.module.update({ where: { key: 'article' }, data: { route: next } })
    const redirect = await page.request.get(old + '/tag/' + run + '?page=1', { maxRedirects: 0 })
    expect(redirect.status()).toBe(301)
    expect(new URL(redirect.headers().location, testBaseURL).href).toBe(
      testBaseURL + next + '/tag/' + run + '?page=1',
    )
    expect(await (await page.request.get('/sitemap.xml')).text()).toContain(next + '/tag/' + run)
    await db.module.update({ where: { key: 'article' }, data: { enabled: false } })
    expect((await page.request.get(next + '/tag/' + run)).status()).toBe(404)
    const search = await page.request.get('/api/v1/search?q=' + run)
    expect((await search.json()).meta.typeCounts.article).toBe(0)
    expect(await (await page.request.get('/rss.xml')).text()).not.toContain('article:' + article)
    expect((await page.request.get('/api/v1/og?resource=article&id=' + run)).status()).toBe(404)
  } finally {
    for (const context of contexts) await context.close()
    await page.close()
    await db.routeAlias.deleteMany({ where: { path: '/old-' + run } })
    if (legacyAliasCreated)
      await db.routeAlias.deleteMany({ where: { path: '/og', moduleKey: 'article' } })
    await db.previewToken.deleteMany({ where: { contentId: { in: [article, draft] } } })
    await db.viewReceipt.deleteMany({ where: { contentId: { in: [article, log, project] } } })
    await db.dailyStat.deleteMany({ where: { contentId: { in: [article, log, project] } } })
    await db.article.deleteMany({ where: { id: { in: [article, draft] } } })
    await db.log.deleteMany({ where: { id: log } })
    await db.project.deleteMany({ where: { id: project } })
    await db.category.deleteMany({ where: { id: category } })
    await db.tag.deleteMany({ where: { id: tag } })
    for (const m of modules)
      await db.module.update({
        where: { key: m.key },
        data: {
          enabled: m.enabled,
          route: m.route,
          config: m.config === null ? Prisma.JsonNull : m.config,
        },
      })
    await db.$disconnect()
  }
})

test('搜索三端暗色减弱动态与无JS均可操作', async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.goto('/search?q=Next')
  await expect(page.locator('h1')).toHaveText('搜索')
  await expect(page.getByRole('navigation', { name: '搜索类型' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await mkdir('docs/verification/phase-e-images', { recursive: true })
  await page.screenshot({
    path: `docs/verification/phase-e-images/search-dark-${testInfo.project.name}.png`,
    fullPage: true,
  })
  const context = await browser.newContext({
    baseURL: testBaseURL,
    javaScriptEnabled: false,
    viewport: page.viewportSize()!,
  })
  try {
    const plain = await context.newPage()
    await plain.goto('/search')
    await plain.getByRole('search').getByRole('textbox').fill('Next')
    await plain.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(plain).toHaveURL(/q=Next/)
    await expect(plain.getByRole('navigation', { name: '搜索类型' })).toBeVisible()
  } finally {
    await context.close()
  }
})
