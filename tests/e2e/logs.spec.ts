import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'

test('快速日志记录到公开阅读、版本冲突、回收站恢复形成闭环', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '日志业务先在桌面验收，布局另做三端')
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('仅允许独立测试库')
  const db = new PrismaClient({ datasources: { db: { url } } })
  const title = '日志闭环-' + Date.now()
  let id: string | undefined
  const mediaIds: string[] = []
  let tagId: string | undefined
  try {
    const actual = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!actual[0]?.name.endsWith('_test')) throw new Error('实际数据库不安全')
    const tag = await db.tag.create({
      data: { name: '日志标签-' + Date.now(), slug: 'log-e2e-' + Date.now() },
    })
    tagId = tag.id
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/logs')
    await expect(page.getByRole('heading', { name: '日志管理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '记一笔', exact: true }).click()
    const started = Date.now()
    const drawer = page.getByRole('dialog', { name: '记一笔', exact: true })
    await drawer.getByLabel('标题', { exact: true }).fill(title)
    await drawer.getByLabel('正文', { exact: true }).fill('## 今日记录\n\n真实日志闭环正文。')
    const image = await sharp(randomBytes(16 * 16 * 3), {
      raw: { width: 16, height: 16, channels: 3 },
    })
      .png()
      .toBuffer()
    const uploading = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/media/upload') &&
        response.request().method() === 'POST',
    )
    const invalidUpload = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/media/upload') && response.status() === 415,
    )
    await drawer.getByLabel('上传图集', { exact: true }).setInputFiles([
      { name: '日志真实图集.png', mimeType: 'image/png', buffer: image },
      { name: '伪装图片.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') },
    ])
    const uploaded = await uploading
    expect(uploaded.status()).toBe(201)
    mediaIds.push((await uploaded.json()).data.id)
    expect((await invalidUpload).status()).toBe(415)
    await expect(drawer.getByRole('button', { name: '保存日志', exact: true })).toBeEnabled()
    await expect(drawer.getByRole('button', { name: '移除', exact: true })).toBeVisible()
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/logs') && response.request().method() === 'POST',
    )
    await drawer.getByRole('button', { name: '保存日志', exact: true }).click()
    const saved = await saving
    expect(saved.status()).toBe(201)
    expect(Date.now() - started).toBeLessThan(60000)
    const item = (await saved.json()).data
    id = item.id
    await expect(drawer).not.toBeVisible()
    const headers = { Origin: testBaseURL }
    const previewToken = await page.request.post('/api/v1/admin/logs/' + id + '/preview-token', {
      headers,
    })
    expect(previewToken.status()).toBe(200)
    const preview = await page.request.get((await previewToken.json()).data.url)
    expect(preview.status()).toBe(200)
    expect(preview.headers()['referrer-policy']).toBe('no-referrer')
    expect(preview.headers()['x-robots-tag']).toContain('noindex')
    expect(preview.headers()['cache-control']).toContain('no-store')
    const entry = await page.request.get('/api/v1/logs/' + id)
    expect(entry.status()).toBe(200)
    expect((await entry.json()).data.content).toContain('真实日志闭环正文')
    const route = (await (await page.request.get('/api/v1/modules')).json()).data.find(
      (item: { key: string }) => item.key === 'log',
    ).route
    await page.goto(route + '/' + id)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText('真实日志闭环正文。', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '打开图集第1张', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '图集查看' }).getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto('/admin/logs/' + id)
    await page
      .getByLabel('正文', { exact: true })
      .fill('## 今日记录\n\n真实日志闭环正文。\n\n编辑闭环补记。')
    const updating = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/logs/' + id) &&
        response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: '保存日志', exact: true }).click()
    expect((await updating).status()).toBe(200)
    await expect(page.getByRole('status')).toHaveText('日志已保存')
    await page.getByLabel('封面地址', { exact: true }).fill('javascript:alert(1)')
    await page.getByLabel('标题', { exact: true }).focus()
    await expect(page.locator('form').getByRole('alert')).toContainText('媒体地址不安全')
    await expect(page.getByLabel('封面地址', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await page.getByRole('button', { name: '保存日志', exact: true }).click()
    await expect(page.getByLabel('封面地址', { exact: true })).toBeFocused()
    await page.getByLabel('封面地址', { exact: true }).fill('')
    await page.getByLabel('标题', { exact: true }).focus()
    expect((await db.log.findUniqueOrThrow({ where: { id } })).publishedAt?.toISOString()).toBe(
      item.publishedAt,
    )
    await page.getByLabel('标题', { exact: true }).fill(title + '未保存')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.evaluate(() => history.back())
    await expect(page).toHaveURL('/admin/logs/' + id)
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(title + '未保存')
    await page.getByLabel('标题', { exact: true }).fill(title)
    const keyboardSave = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/logs/' + id) &&
        response.request().method() === 'PATCH',
    )
    await page.keyboard.press('Control+s')
    expect((await keyboardSave).status()).toBe(200)
    await expect(page.getByRole('status')).toHaveText('日志已保存')
    expect(
      (
        await page.request.patch('/api/v1/admin/logs/' + id, {
          headers,
          data: { revision: item.revision, title: '旧稿覆盖' },
        })
      ).status(),
    ).toBe(409)
    await page.goto('/admin/logs?view=list&q=' + encodeURIComponent(title))
    const row = page.locator('tr').filter({ hasText: title })
    await page.getByLabel('开始日期', { exact: true }).fill(item.logDate)
    await expect(page).toHaveURL(/from=/)
    await page.getByLabel('结束日期', { exact: true }).fill(item.logDate)
    await expect(page).toHaveURL(/to=/)
    await row.getByRole('checkbox', { name: '选择' + title, exact: true }).check()
    await page.getByLabel('批量标签选择', { exact: true }).selectOption(tag.id)
    const tagged = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/logs/bulk') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '添加标签', exact: true }).click()
    expect((await tagged).status()).toBe(200)
    await expect(page.getByRole('status')).toContainText('成功1条，失败0条')
    await page.getByLabel('日志标签筛选', { exact: true }).selectOption(tag.slug)
    await expect(row).toBeVisible()
    expect(
      (await db.log.findUniqueOrThrow({ where: { id }, include: { tags: true } })).tags.map(
        (value) => value.id,
      ),
    ).toContain(tag.id)
    page.once('dialog', (dialog) => dialog.accept())
    await row.getByRole('button', { name: '移入回收站', exact: true }).click()
    await expect(row).toHaveCount(0)
    expect((await page.request.get('/api/v1/logs/' + id)).status()).toBe(404)
    await page.goto('/admin/logs/trash')
    const trashRow = page.locator('tr').filter({ hasText: title })
    page.once('dialog', (dialog) => dialog.accept())
    await trashRow.getByRole('button', { name: '恢复', exact: true }).click()
    await expect(trashRow).toHaveCount(0)
    expect((await page.request.get('/api/v1/logs/' + id)).status()).toBe(200)
  } finally {
    if (id) {
      await db.previewToken.deleteMany({ where: { kind: 'log', contentId: id } })
      await db.log.deleteMany({ where: { id } })
    }
    for (const mediaId of mediaIds)
      expect(
        (
          await page.request.delete('/api/v1/admin/media/' + mediaId, {
            headers: { Origin: testBaseURL },
          })
        ).status(),
      ).toBe(200)
    if (tagId) await db.tag.deleteMany({ where: { id: tagId } })
    await db.$disconnect()
  }
})

test('日志三端日历与无JS可读，视图偏好可恢复', async ({ page, browser }, testInfo) => {
  await page.goto('/logs?view=list')
  await expect(page.locator('h1')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('link', { name: '日历', exact: true }).click()
  await expect(page.getByRole('region', { name: '日志日历', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('log-public-view'))).toBe('calendar')
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({
    path: 'docs/verification/phase-d-images/log-calendar-dark-' + testInfo.project.name + '.png',
    fullPage: true,
  })
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: testInfo.project.use.viewport,
  })
  try {
    const plain = await noJs.newPage()
    await plain.goto('/logs?view=calendar&year=2025&month=1')
    await expect(plain.getByRole('region', { name: '日志日历', exact: true })).toBeVisible()
    await plain.getByRole('link', { name: '下个月', exact: true }).click()
    await expect(plain).toHaveURL(/month=2/)
    expect(await plain.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
  } finally {
    await noJs.close()
  }
})

test('移动日志加载更多追加记录并保留已经阅读的内容', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== '390', '移动端加载更多交互')
  await page.goto('/logs?view=list&pageSize=1')
  const articles = page.locator('main article')
  const before = await articles.count()
  const title = await articles.first().locator('h3').innerText()
  await page.getByRole('link', { name: /加载更多/ }).click()
  await expect(articles).toHaveCount(before + 1)
  await expect(articles.first().locator('h3')).toHaveText(title)
  const listUrl = page.url()
  const detailPath = (await articles.last().getByRole('link').first().getAttribute('href'))!
  await articles.last().getByRole('link').first().click()
  await expect(page).toHaveURL(detailPath)
  const position = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('log-return')!).scroll,
  )
  await page.locator('nav[aria-label="相邻日志"] a').first().click()
  await page.locator('nav[aria-label="相邻日志"] a[href="' + detailPath + '"]').click()
  await page.getByRole('link', { name: '← 返回日志列表', exact: true }).first().click()
  await expect(page).toHaveURL(listUrl)
  await expect(articles).toHaveCount(before + 1)
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThanOrEqual(Math.max(0, position - 5))
})

test('日志图集支持键盘切换、失效占位与Esc回焦', async ({ page }) => {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('仅允许独立测试库')
  const db = new PrismaClient({ datasources: { db: { url } } })
  let id: string | undefined
  try {
    const actual = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!actual[0]?.name.endsWith('_test')) throw new Error('实际数据库不安全')
    const item = await db.log.create({
      data: {
        title: '图集验收',
        content: '图集阅读正文',
        type: 'DAILY',
        logDate: new Date('2025-01-15'),
        status: 'PUBLISHED',
        publishedAt: new Date('2025-01-15'),
        images: ['/media/missing-first.png', '/media/missing-second.png'],
      },
    })
    id = item.id
    await page.goto('/logs/' + id)
    const first = page.getByRole('link', { name: '打开图集第1张', exact: true })
    await first.click()
    const dialog = page.getByRole('dialog', { name: '图集查看', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('1/2', { exact: true })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(dialog.getByText('2/2', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('img', { name: '图集验收图集2（图片暂不可用）' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(first).toBeFocused()
  } finally {
    if (id) await db.log.deleteMany({ where: { id } })
    await db.$disconnect()
  }
})
