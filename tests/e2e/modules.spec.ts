import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

test('后台模块关闭撤销、嵌套配置和连续改路径同步到公共入口', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '模块业务在桌面验证，导航另做三视口回归')
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  await page.goto('/admin/modules')
  await expect(page.getByRole('heading', { name: '模块开关', exact: true })).toBeVisible({
    timeout: 3000,
  })
  const card = page.getByTestId('module-article')
  const published = (await (await page.request.get('/api/v1/articles')).json()).data
  try {
    await card.getByRole('switch', { name: '文章显示' }).click()
    const dialog = page.getByRole('dialog', { name: '关闭文章模块' })
    await expect(dialog).toContainText('完整保留')
    const savedClose = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/modules/article') &&
        response.request().method() === 'PATCH',
    )
    await dialog.getByRole('button', { name: '确认关闭', exact: true }).click()
    expect((await savedClose).status()).toBe(200)
    await expect(card.getByRole('switch', { name: '文章显示' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    const closed = await page.request.get('/api/v1/articles')
    expect(closed.status()).toBe(200)
    expect((await closed.json()).data).toEqual([])
    const closedFeed = await page.request.get('/api/v1/feed')
    expect(closedFeed.status()).toBe(200)
    expect((await closedFeed.json()).data.latestArticles).toEqual([])
    if (published.length)
      expect((await page.request.get('/api/v1/articles/' + published[0].slug)).status()).toBe(404)
    expect(
      (await (await page.request.get('/api/v1/site')).json()).data.modules.some(
        (item: { key: string }) => item.key === 'article',
      ),
    ).toBe(false)
    expect(
      (await (await page.request.get('/api/v1/home')).json()).data.sections.some(
        (item: { key: string }) => item.key === 'article',
      ),
    ).toBe(false)
    expect(await (await page.request.get('/')).text()).not.toContain('href="/articles"')
    await page.getByRole('button', { name: '撤销关闭文章', exact: true }).click()
    await expect(card.getByRole('switch', { name: '文章显示' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  } finally {
    // 中途断言失败也恢复测试开关，不让下一轮继承关闭的夹具。
    const entries = (await (await page.request.get('/api/v1/admin/modules')).json()).data
    const articleModule = entries.find((entry: { key: string }) => entry.key === 'article')
    if (!articleModule.enabled) {
      const restored = await page.request.patch('/api/v1/admin/modules/article', {
        headers: { Origin: 'http://localhost:3000' },
        data: { enabled: true, expectedUpdatedAt: articleModule.updatedAt },
      })
      expect(restored.status()).toBe(200)
    }
  }
  const response = await page.request.get('/api/v1/admin/modules')
  const original = (await response.json()).data.find(
    (item: { key: string }) => item.key === 'article',
  )
  const headers = { Origin: 'http://localhost:3000' }
  const firstRoute = `/notes-${Date.now()}`
  const secondRoute = firstRoute.replace('notes-', 'essays-')
  try {
    await card.getByRole('button', { name: '配置文章', exact: true }).click()
    const drawer = page.getByRole('dialog', { name: '文章模块配置' })
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
    await drawer.getByLabel('列表每页条数').fill('7')
    await drawer.getByLabel('首页露出条数').fill('2')
    await drawer.getByLabel('栏目导语').fill('文章配置导语验收')
    await drawer.getByLabel('空态文案').fill('配置空态验收')
    await drawer.getByLabel('显示文章目录').uncheck()
    await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(drawer).not.toBeVisible()
    let current = (await (await page.request.get('/api/v1/admin/modules')).json()).data.find(
      (item: { key: string }) => item.key === 'article',
    )
    expect(current.config.pageSize).toBe(7)
    expect(current.config.home).toMatchObject({ ...original.config.home, limit: 2 })
    for (const route of [firstRoute, secondRoute]) {
      const save = await page.request.patch('/api/v1/admin/modules/article', {
        headers,
        data: { route, expectedUpdatedAt: current.updatedAt },
      })
      expect(save.status()).toBe(200)
      current = (await save.json()).data.module
    }
    // 旧地址直接跳最新路径，后缀和query均保留，避免多次改路由产生跳转链。
    const old = await page.request.get(`${original.route}/test-slug?tag=next&page=2`, {
      maxRedirects: 0,
    })
    expect(old.status()).toBe(301)
    expect(new URL(old.headers().location, 'http://localhost:3000').pathname).toBe(
      `${secondRoute}/test-slug`,
    )
    expect(new URL(old.headers().location, 'http://localhost:3000').search).toBe('?tag=next&page=2')
    const middle = await page.request.get(`${firstRoute}?q=中文`, { maxRedirects: 0 })
    expect(middle.status()).toBe(301)
    expect(new URL(middle.headers().location, 'http://localhost:3000').pathname).toBe(secondRoute)
    await page.goto('/')
    await expect(
      page
        .locator('header')
        .getByRole('link', { name: original.navLabel ?? original.name, exact: true }),
    ).toHaveAttribute('href', secondRoute)
    await page.goto(secondRoute)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByText('文章配置导语验收', { exact: true })).toBeVisible()
    await page.goto(secondRoute + '?q=does-not-exist-' + Date.now())
    await expect(page.getByText('配置空态验收', { exact: true })).toBeVisible()
    if (published.length) {
      await page.goto(secondRoute + '/' + published[0].slug)
      await expect(page.getByText('文章目录', { exact: true })).toHaveCount(0)
    }
  } finally {
    const current = (await (await page.request.get('/api/v1/admin/modules')).json()).data.find(
      (item: { key: string }) => item.key === 'article',
    )
    const restored = await page.request.patch('/api/v1/admin/modules/article', {
      headers,
      data: {
        route: original.route,
        config: original.config,
        expectedUpdatedAt: current.updatedAt,
      },
    })
    expect(restored.status()).toBe(200)
  }
  // 设置修改经过真实表单和公共请求，清空字段明确保留null语义。
  const originalSettings = (await (await page.request.get('/api/v1/admin/settings/general')).json())
    .data
  try {
    await page.goto('/admin/settings/general')
    await page.getByLabel('站点名称', { exact: true }).fill('配置闭环验收')
    await page.getByLabel('Logo地址', { exact: true }).fill('')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('设置已保存')
    const site = (await (await page.request.get('/api/v1/site')).json()).data
    expect(site.site.name).toBe('配置闭环验收')
    expect(site.site.logo).toBeNull()
    await page.goto('/')
    await expect(
      page.locator('header').getByRole('link', { name: '配置闭环验收首页', exact: true }),
    ).toBeVisible()
    const loginHtml = await (await page.request.get('/login')).text()
    expect(loginHtml).toContain('name="application-name" content="配置闭环验收"')
  } finally {
    expect(
      (
        await page.request.patch('/api/v1/admin/settings/general', {
          headers,
          data: originalSettings,
        })
      ).status(),
    ).toBe(200)
  }
  await page.goto('/admin/audit-logs')
  await expect(page.getByRole('heading', { name: '审计日志', exact: true })).toBeVisible()
  await page.getByLabel('资源', { exact: true }).selectOption('module')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await expect(page.locator('main article').first()).toContainText('module')
  await page.locator('main article').first().getByText('查看变更前后', { exact: true }).click()
  await expect(
    page.locator('main article').first().getByRole('heading', { name: '变更前', exact: true }),
  ).toBeVisible()
  // AT失效时middleware只放行非敏感提示，真正刷新由后台会话入口完成。
  await page.context().clearCookies({ name: 'at' })
  await page.goto('/admin/modules')
  await expect(page.getByRole('heading', { name: '模块开关', exact: true })).toBeVisible()
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200)
  // 只在独立测试库设置隐私夹具，实际检查HTML、metadata和公共DTO，结束恢复原值。
  const testUrl = process.env.TEST_DATABASE_URL
  if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
    throw new Error('隐私夹具仅允许独立测试库')
  const db = new PrismaClient({ datasources: { db: { url: testUrl } } })
  const profile = await db.profile.findUniqueOrThrow({ where: { id: 'default' } })
  const articleModule = await db.module.findUniqueOrThrow({ where: { key: 'article' } })
  try {
    await db.profile.update({
      where: { id: 'default' },
      data: { contactVisible: false, email: 'hidden@example.com', phone: '+86 138 0013 8000' },
    })
    await db.module.update({
      where: { key: 'article' },
      data: { name: '文章 hidden@example.com', description: '联系 +86 138 0013 8000' },
    })
    for (const path of [
      '/',
      articleModule.route,
      '/login',
      '/api/v1/site',
      '/api/v1/home',
      '/api/v1/modules',
    ]) {
      const html = await (await page.request.get(path)).text()
      for (const contact of ['hidden@example.com', '+86 138 0013 8000', 'mailto:', 'tel:'])
        expect(html.includes(contact), path + '公开联系方式检查').toBe(false)
    }
  } finally {
    await db.profile.update({
      where: { id: 'default' },
      data: { contactVisible: profile.contactVisible, email: profile.email, phone: profile.phone },
    })
    await db.module.update({
      where: { key: 'article' },
      data: { name: articleModule.name, description: articleModule.description },
    })
    await db.$disconnect()
  }
})
