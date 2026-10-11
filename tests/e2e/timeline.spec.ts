import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('只允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
test('时间线年精度编辑、公开展开、版本冲突与复制形成闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '后台业务桌面验收')
  const db = database(),
    ids: string[] = [],
    prefix = '时间线闭环-' + Date.now()
  try {
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/timeline/new')
    await page.getByLabel('经历标题', { exact: true }).fill(prefix)
    await page.getByLabel('公司或机构', { exact: true }).fill('真实职业经历')
    await page.getByLabel('开始日期精度', { exact: true }).selectOption('YEAR')
    await page.getByLabel('开始日期', { exact: true }).fill('2020')
    await page.getByLabel('结束日期', { exact: true }).fill('2022-03')
    await page.getByLabel('关键成果', { exact: true }).fill('完成跨团队工程化落地')
    await page
      .getByLabel('正文', { exact: true })
      .fill('## 选择与结果\n\n这是一段可折叠的真实经历。')
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '保存经历', exact: true }).click()
    const saved = await saving
    expect(saved.status()).toBe(201)
    const item = (await saved.json()).data
    ids.push(item.id)
    expect(item.startDate).toBe('2020-01-01T00:00:00.000Z')
    expect(item.startPrecision).toBe('YEAR')
    const route = (await (await page.request.get('/api/v1/modules')).json()).data.find(
      (module: { key: string }) => module.key === 'timeline',
    ).route
    await page.goto(route)
    const card = page.locator('[data-timeline-id="' + item.id + '"]')
    await expect(card.getByRole('heading', { name: prefix, exact: true })).toBeVisible()
    await expect(card.getByText('2020 年 — 2022.03', { exact: true })).toBeVisible()
    await card.getByText('展开经历详情', { exact: true }).click()
    await expect(card.getByText('这是一段可折叠的真实经历。', { exact: true })).toBeVisible()
    expect((await page.request.get(route + '/' + item.id)).status()).toBe(404)
    await page.goto('/admin/timeline/' + item.id)
    await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue('2020')
    const me = (await (await page.request.get('/api/v1/auth/me')).json()).data
    await page.evaluate(
      (key) => localStorage.setItem(key, '{broken'),
      'timeline-draft:' + me.id + ':' + item.id,
    )
    await page.reload()
    await expect(page.getByLabel('经历标题', { exact: true })).toHaveValue(prefix)
    await expect(page.getByRole('status')).toContainText('本地稿无法读取')
    const newer = await page.request.patch('/api/v1/admin/timeline/' + item.id, {
      headers: { Origin: testBaseURL },
      data: { revision: 1, title: prefix + '-新版本' },
    })
    expect(newer.status()).toBe(200)
    await page.getByLabel('副标题', { exact: true }).fill('不能覆盖新版本')
    const conflicted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + item.id) && response.status() === 409,
    )
    await page.getByRole('button', { name: '保存经历', exact: true }).click()
    await conflicted
    await expect(page.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
    const copied = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '另存新经历', exact: true }).click()
    const copy = (await (await copied).json()).data
    ids.push(copy.id)
    expect(copy.visible).toBe(false)
    expect(copy.showOnAbout).toBe(false)
    expect(copy.startPrecision).toBe('YEAR')
  } finally {
    await db.timelineItem.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})

test('时间线当前项排序、响应布局、早期折叠及无JS三端可用', async ({ page, browser }, info) => {
  const db = database(),
    ids: string[] = [],
    prefix = '时间线布局-' + Date.now()
  try {
    for (let index = 0; index < 32; index++) {
      const item = await db.timelineItem.create({
        data: {
          title: prefix + '-' + index,
          type: 'WORK',
          startDate: new Date(2000 + index + '-01-01'),
          startPrecision: index % 2 ? 'MONTH' : 'YEAR',
          isCurrent: index === 0,
          description: '## 相同成果标题\n\n完整经历正文-' + index,
          visible: true,
          order: 0,
        },
      })
      ids.push(item.id)
    }
    const route = (await (await page.request.get('/api/v1/modules')).json()).data.find(
      (entry: { key: string }) => entry.key === 'timeline',
    ).route
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.goto(route + '?q=' + encodeURIComponent(prefix))
    const visible = page.locator('[data-timeline-id]').filter({ visible: true })
    await expect(
      visible.first().getByRole('heading', { name: prefix + '-0', exact: true }),
    ).toBeVisible()
    if (info.project.name !== '1440') {
      await expect(visible).toHaveCount(30)
      await page.getByText('更早的经历（2条）', { exact: true }).click()
      await expect(visible).toHaveCount(32)
    } else await expect(visible).toHaveCount(32)
    const first = await visible.nth(0).boundingBox(),
      second = await visible.nth(1).boundingBox()
    if (!first || !second) throw new Error('时间线卡片无布局')
    if (info.project.name === '1440') expect(Math.abs(first.x - second.x)).toBeGreaterThan(200)
    else expect(Math.abs(first.x - second.x)).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
        return new Set(ids).size === ids.length
      }),
    ).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/timeline-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: info.project.use.viewport,
    })
    const native = await context.newPage()
    await native.goto(testBaseURL + route + '?q=' + encodeURIComponent(prefix))
    const nativeCard = native
      .locator('[data-timeline-id="' + ids[0] + '"]')
      .filter({ visible: true })
    await nativeCard.getByText('展开经历详情', { exact: true }).click()
    await expect(nativeCard.getByText('完整经历正文-0', { exact: true })).toBeVisible()
    await context.close()
  } finally {
    await db.timelineItem.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})

test('时间线列表键盘同日期重排、独立开关、回收站恢复与彻底删除', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '列表桌面闭环')
  const db = database(),
    ids: string[] = [],
    prefix = '经历列表-' + Date.now()
  try {
    for (let index = 0; index < 3; index++) {
      const item = await db.timelineItem.create({
        data: {
          title: prefix + '-' + index,
          type: 'WORK',
          startDate: new Date(index < 2 ? '2020-01-01' : '2019-01-01'),
          startPrecision: 'YEAR',
          order: index === 1 ? 1 : 0,
          visible: true,
          showOnAbout: true,
        },
      })
      ids.push(item.id)
    }
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    const listing = '/admin/timeline?q=' + encodeURIComponent(prefix)
    await page.goto(listing)
    const older = page.getByRole('row').filter({ hasText: prefix + '-2' })
    await expect(
      older.getByRole('button', { name: '上移 ' + prefix + '-2', exact: true }),
    ).toBeDisabled()
    const handle = page.getByRole('button', { name: '拖拽排序 ' + prefix + '-1', exact: true })
    await handle.focus()
    const reordering = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/reorder') &&
        response.request().method() === 'PATCH',
    )
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('status')).toContainText('moved over droppable area ' + ids[1])
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('status')).toContainText('droppable area ' + ids[0])
    await page.keyboard.press('Space')
    const reordered = await reordering
    expect(reordered.status()).toBe(200)
    expect(
      reordered
        .request()
        .postDataJSON()
        .items.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([ids[0], ids[1]].sort())
    const sorted = await db.timelineItem.findMany({
      where: { id: { in: ids } },
      orderBy: [{ startDate: 'desc' }, { order: 'asc' }, { id: 'asc' }],
    })
    expect(sorted.map((item) => item.id)).toEqual([ids[1], ids[0], ids[2]])
    const visible = page.getByRole('checkbox', {
      name: '时间戳页显示 ' + prefix + '-1',
      exact: true,
    })
    await expect(visible).toBeEnabled()
    const hiding = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + ids[1]) &&
        response.request().method() === 'PATCH',
    )
    await visible.click()
    expect((await hiding).status()).toBe(200)
    await expect(visible).not.toBeChecked()
    const hidden = await db.timelineItem.findUniqueOrThrow({ where: { id: ids[1] } })
    expect(hidden.visible).toBe(false)
    expect(hidden.showOnAbout).toBe(true)
    const publicList = await page.request.get('/api/v1/timeline?q=' + encodeURIComponent(prefix))
    expect((await publicList.json()).data.map((item: { id: string }) => item.id)).not.toContain(
      ids[1],
    )
    const about = page.getByRole('checkbox', { name: '关于我页显示 ' + prefix + '-1', exact: true })
    await expect(about).toBeEnabled()
    const hideAbout = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + ids[1]) &&
        response.request().method() === 'PATCH',
    )
    await about.click()
    expect((await hideAbout).status()).toBe(200)
    await expect(about).not.toBeChecked()
    expect((await db.timelineItem.findUniqueOrThrow({ where: { id: ids[1] } })).showOnAbout).toBe(
      false,
    )
    const row = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await expect(row.getByRole('button', { name: '删除', exact: true })).toBeEnabled()
    page.once('dialog', (dialog) => dialog.accept())
    const deleting = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + ids[1]) &&
        response.request().method() === 'DELETE',
    )
    await row.getByRole('button', { name: '删除', exact: true }).click()
    expect((await deleting).status()).toBe(204)
    await page.goto('/admin/timeline/trash?q=' + encodeURIComponent(prefix))
    const trash = page.getByRole('row').filter({ hasText: prefix + '-1' })
    page.once('dialog', (dialog) => dialog.accept())
    const restoring = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/timeline/' + ids[1] + '/restore'),
    )
    await trash.getByRole('button', { name: '恢复', exact: true }).click()
    expect((await restoring).status()).toBe(200)
    await page.goto(listing)
    const restored = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await expect(restored.getByRole('link', { name: '复制', exact: true })).toHaveAttribute(
      'href',
      '/admin/timeline/new?copy=' + ids[1],
    )
    page.once('dialog', (dialog) => dialog.accept())
    const deletingAgain = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + ids[1]) &&
        response.request().method() === 'DELETE',
    )
    await restored.getByRole('button', { name: '删除', exact: true }).click()
    await deletingAgain
    await page.goto('/admin/timeline/trash?q=' + encodeURIComponent(prefix))
    page.once('dialog', (dialog) => dialog.accept(prefix + '-1'))
    const purging = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/timeline/' + ids[1] + '/purge'),
    )
    await page
      .getByRole('row')
      .filter({ hasText: prefix + '-1' })
      .getByRole('button', { name: '彻底删除', exact: true })
      .click()
    expect((await purging).status()).toBe(204)
    expect(await db.timelineItem.findUnique({ where: { id: ids[1] } })).toBeNull()
  } finally {
    await db.timelineItem.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})
