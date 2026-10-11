import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { emptyProjectDraft } from '../../src/lib/project-draft'

function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('仅允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}

test('作品裁切上传、无正文发布、私有预览和版本冲突闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '业务桌面闭环，展示另做三端')
  const db = database(),
    ids: string[] = [],
    media: string[] = []
  const title = '作品闭环-' + Date.now()
  try {
    const actual = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    expect(actual[0].name.endsWith('_test')).toBe(true)
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/projects/new')
    await page.getByLabel('作品标题', { exact: true }).fill(title)
    await page.getByLabel('作品简介', { exact: true }).fill('只有外链也能展示真实成果')
    await page.getByLabel('作品类型', { exact: true }).selectOption('REPO')
    await page.getByLabel('技术栈', { exact: true }).fill('TypeScript\nPostgreSQL')
    await page.getByLabel('成果亮点', { exact: true }).fill('减少30%重复操作\n完整权限闭环')
    await page.getByLabel('首页精选', { exact: true }).check()
    const image = await sharp(randomBytes(32 * 40 * 3), {
      raw: { width: 32, height: 40, channels: 3 },
    })
      .png()
      .toBuffer()
    await page
      .getByLabel('选择裁切封面', { exact: true })
      .setInputFiles({ name: '作品封面.png', mimeType: 'image/png', buffer: image })
    await expect(
      page.getByRole('button', { name: '应用裁切并上传封面', exact: true }),
    ).toBeEnabled()
    const uploading = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/media/upload') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '应用裁切并上传封面', exact: true }).click()
    const uploaded = await uploading
    expect(uploaded.status()).toBe(201)
    const asset = (await uploaded.json()).data
    media.push(asset.id)
    expect(asset.width).toBe(1600)
    expect(asset.height).toBe(900)
    await expect(page.getByLabel('封面地址', { exact: true })).toHaveValue(asset.url)
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '保存作品', exact: true }).click()
    const saved = await saving
    expect(saved.status()).toBe(201)
    const record = (await saved.json()).data
    ids.push(record.id)
    await expect(page.getByRole('status')).toHaveText('作品已保存')
    expect(record.content).toBeNull()
    const origin = { Origin: testBaseURL }
    const preview = await page.request.post(
      '/api/v1/admin/projects/' + record.id + '/preview-token',
      { headers: origin },
    )
    expect(preview.status()).toBe(200)
    const privatePage = await page.request.get((await preview.json()).data.url)
    expect(privatePage.status()).toBe(200)
    expect(privatePage.headers()['cache-control']).toContain('no-store')
    expect(privatePage.headers()['referrer-policy']).toBe('no-referrer')
    expect(privatePage.headers()['x-robots-tag']).toContain('noindex')
    const route = (await (await page.request.get('/api/v1/modules')).json()).data.find(
      (entry: { key: string }) => entry.key === 'portfolio',
    ).route
    await page.goto('/')
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await page.goto(route + '/' + record.slug)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText('只有外链也能展示真实成果', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '作品正文' })).toHaveCount(0)
    await page.goto('/admin/projects/' + record.id)
    await expect(page.getByLabel('作品标题', { exact: true })).toHaveValue(title)
    const newer = await page.request.patch('/api/v1/admin/projects/' + record.id, {
      headers: origin,
      data: { revision: record.revision, subtitle: '另一标签页已修改' },
    })
    expect(newer.status()).toBe(200)
    await page.getByLabel('一句话亮点', { exact: true }).fill('旧版本不能覆盖')
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/' + record.id) && response.status() === 409,
    )
    await page.getByRole('button', { name: '保存作品', exact: true }).click()
    await conflict
    await expect(page.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
    expect((await db.project.findUniqueOrThrow({ where: { id: record.id } })).subtitle).toBe(
      '另一标签页已修改',
    )
  } finally {
    await db.project.deleteMany({ where: { id: { in: ids } } })
    for (const id of media)
      await page.request.delete('/api/v1/admin/media/' + id, {
        headers: { Origin: testBaseURL },
      })
    await db.$disconnect()
  }
})

test('作品四类型筛选、暗色图集键盘与无JS详情三端可用', async ({ page, browser }, info) => {
  const db = database(),
    ids: string[] = []
  const prefix = '作品展示-' + Date.now()
  let tagId: string | undefined
  try {
    const tag = await db.tag.create({
      data: { name: prefix + '标签', slug: 'project-tag-' + Date.now() },
    })
    tagId = tag.id
    for (const type of ['GAME', 'REPO', 'SKILL', 'OTHER'] as const) {
      const item = await db.project.create({
        data: {
          title: prefix + '-' + type,
          slug: 'project-display-' + Date.now() + '-' + type,
          type,
          description: '真实作品信息',
          highlights: ['成果一', '成果二', '成果三', '成果四'],
          techStack: ['Frontend'],
          status: 'PUBLISHED',
          publishedAt: new Date('2020-01-01'),
          gallery: ['/favicon.ico', '/not-found-gallery.png'],
          order: 0,
          ...(type === 'GAME' ? { tags: { connect: { id: tag.id } } } : {}),
        },
      })
      ids.push(item.id)
    }
    const route = (await (await page.request.get('/api/v1/modules')).json()).data.find(
      (entry: { key: string }) => entry.key === 'portfolio',
    ).route
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.goto(route + '?q=' + encodeURIComponent(prefix))
    await expect(page.getByRole('link', { name: prefix + '-SKILL', exact: true })).toBeVisible()
    const games = page
      .getByRole('navigation', { name: '作品类型' })
      .getByRole('link')
      .filter({ hasText: '游戏' })
    await games.click()
    await expect(page.getByRole('link', { name: prefix + '-GAME', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: prefix + '-SKILL', exact: true })).toHaveCount(0)
    await page.goto(route + '?q=' + encodeURIComponent(prefix) + '&tag=' + tag.slug)
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('tag=' + tag.slug))
    await expect(page.getByRole('link', { name: prefix + '-GAME', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: prefix + '-REPO', exact: true })).toHaveCount(0)
    const item = await db.project.findUniqueOrThrow({ where: { id: ids[0] } })
    await page.goto(route + '/' + item.slug)
    await page.getByRole('link', { name: '打开图集第1张', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '图集查看' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(
      dialog.getByRole('button', { name: '切换到图集第2张', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: '切换到图集第1张', exact: true }).click()
    await expect(
      dialog.getByRole('button', { name: '切换到图集第1张', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    if (info.project.name === '390') {
      const target = dialog.locator('[class*="max-h"]').first(),
        box = await target.boundingBox()
      if (!box) throw new Error('图集触摸区域不可见')
      const session = await page.context().newCDPSession(page)
      const startX = box.x + box.width * 0.8,
        y = box.y + Math.min(box.height / 2, 100)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: startX, y }],
      })
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: box.x + box.width * 0.2, y }],
      })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(
        dialog.getByRole('button', { name: '切换到图集第2张', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await session.detach()
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('link', { name: '打开图集第1张', exact: true })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/project-detail-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: info.project.use.viewport,
    })
    const native = await context.newPage()
    await native.goto(testBaseURL + route + '/' + item.slug)
    await expect(native.getByRole('heading', { name: item.title, exact: true })).toBeVisible()
    await expect(native.getByRole('link', { name: '打开图集第1张', exact: true })).toHaveAttribute(
      'href',
      '/favicon.ico',
    )
    await context.close()
  } finally {
    await db.project.deleteMany({ where: { id: { in: ids } } })
    if (tagId) await db.tag.delete({ where: { id: tagId } })
    await db.$disconnect()
  }
})

test('后台作品重排、批量部分冲突、删除恢复与彻底删除', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '后台业务桌面验收')
  const db = database(),
    ids: string[] = [],
    prefix = '作品列表-' + Date.now()
  try {
    for (let index = 0; index < 2; index++) {
      const row = await db.project.create({
        data: {
          title: prefix + '-' + index,
          slug: 'project-list-' + Date.now() + '-' + index,
          description: '列表验收',
          type: 'REPO',
          status: 'DRAFT',
          order: index + 5,
        },
      })
      ids.push(row.id)
    }
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.evaluate(() => localStorage.setItem('project-admin-view', 'grid'))
    await page.goto('/admin/projects?q=' + encodeURIComponent(prefix) + '&page=2&pageSize=1')
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByRole('button', { name: '网格', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: '列表', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    const listing = '/admin/projects?q=' + encodeURIComponent(prefix) + '&view=list'
    await page.goto(listing)
    const second = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await expect(second.getByRole('link', { name: prefix + '-1', exact: true })).toBeVisible()
    await second.getByLabel('更多操作：' + prefix + '-1', { exact: true }).click()
    const sorting = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/reorder') &&
        response.request().method() === 'PATCH',
    )
    await second.getByRole('button', { name: '上移', exact: true }).click()
    expect((await sorting).status()).toBe(200)
    await expect(page.getByRole('status')).toContainText('排序已保存')
    const ordered = await db.project.findMany({
      where: { id: { in: ids } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    expect(ordered.map((item) => item.id)).toEqual([ids[1], ids[0]])
    await expect(page.getByLabel('全选当前页', { exact: true })).toBeEnabled()
    await page.getByLabel('全选当前页', { exact: true }).check()
    await db.project.update({ where: { id: ids[0] }, data: { revision: { increment: 1 } } })
    const batch = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/bulk') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '发布', exact: true }).click()
    expect((await batch).status()).toBe(200)
    await expect(page.getByRole('status')).toContainText('成功1条，失败1条')
    await expect(page.getByText('已选1条（含其它页）', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '清空选择', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await row.getByLabel('更多操作：' + prefix + '-1', { exact: true }).click()
    page.once('dialog', (dialog) => dialog.accept())
    const deleting = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/' + ids[1]) &&
        response.request().method() === 'DELETE',
    )
    await row.getByRole('button', { name: '移入回收站', exact: true }).click()
    expect((await deleting).status()).toBe(204)
    expect((await page.request.get('/api/v1/projects/' + ordered[0].slug)).status()).toBe(404)
    await page.goto('/admin/projects/trash?q=' + encodeURIComponent(prefix))
    const trashed = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await trashed.getByLabel('更多操作：' + prefix + '-1', { exact: true }).click()
    page.once('dialog', (dialog) => dialog.accept())
    const restoring = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/projects/' + ids[1] + '/restore'),
    )
    await trashed.getByRole('button', { name: '恢复', exact: true }).click()
    expect((await restoring).status()).toBe(200)
    expect((await page.request.get('/api/v1/projects/' + ordered[0].slug)).status()).toBe(200)
    await page.goto(listing)
    const restored = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await restored.getByLabel('更多操作：' + prefix + '-1', { exact: true }).click()
    page.once('dialog', (dialog) => dialog.accept())
    const deletingAgain = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/' + ids[1]) &&
        response.request().method() === 'DELETE',
    )
    await restored.getByRole('button', { name: '移入回收站', exact: true }).click()
    await deletingAgain
    await page.goto('/admin/projects/trash?q=' + encodeURIComponent(prefix))
    const purgingRow = page.getByRole('row').filter({ hasText: prefix + '-1' })
    await purgingRow.getByLabel('更多操作：' + prefix + '-1', { exact: true }).click()
    page.once('dialog', (dialog) => dialog.accept(prefix + '-1'))
    const purging = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/projects/' + ids[1] + '/purge'),
    )
    await purgingRow.getByRole('button', { name: '彻底删除', exact: true }).click()
    expect((await purging).status()).toBe(204)
    expect(await db.project.findUnique({ where: { id: ids[1] } })).toBeNull()
  } finally {
    await db.project.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})

test('作品保存期间恢复稿件和图集拖放不会覆盖已提交快照', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '保存并发交互桌面验收')
  const db = database(),
    prefix = '作品保存锁-' + Date.now()
  let id: string | undefined,
    release = () => {}
  try {
    const item = await db.project.create({
      data: {
        title: prefix,
        slug: 'project-lock-' + Date.now(),
        description: '保存锁',
        type: 'REPO',
        gallery: ['/favicon.ico', '/second-image.png'],
        status: 'DRAFT',
      },
    })
    id = item.id
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    const user = (await (await page.request.get('/api/v1/auth/me')).json()).data
    const local = {
      ...emptyProjectDraft(),
      title: '本地尚未恢复',
      slug: 'local-copy',
      description: '本地稿',
      status: 'DRAFT' as const,
    }
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: 'project-draft:' + user.id + ':' + id,
      value: { draft: local, revision: 1 },
    })
    await page.goto('/admin/projects/' + id)
    await expect(page.getByRole('button', { name: '恢复作品草稿', exact: true })).toBeEnabled()
    await page.getByLabel('一句话亮点', { exact: true }).fill('提交的快照')
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/v1/admin/projects/' + id, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue()
        return
      }
      const response = await route.fetch()
      await hold
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '保存作品', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复作品草稿', exact: true })).toBeDisabled()
    const gallery = page.locator('[data-project-field="gallery"] > div[draggable]')
    await expect(gallery.first()).toHaveAttribute('draggable', 'false')
    await gallery.first().evaluate((element) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', '1')
      element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
      )
    })
    await expect(gallery.first()).toContainText('/favicon.ico')
    release()
    await expect(page.getByRole('status')).toHaveText('作品已保存')
    await expect(page.getByLabel('作品标题', { exact: true })).toHaveValue(prefix)
    expect((await db.project.findUniqueOrThrow({ where: { id } })).gallery).toEqual([
      '/favicon.ico',
      '/second-image.png',
    ])
  } finally {
    release()
    if (id) await db.project.delete({ where: { id } })
    await db.$disconnect()
  }
})
