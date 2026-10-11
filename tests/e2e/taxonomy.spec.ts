import { testBaseURL } from './base-url'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('只允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
const headers = { Origin: testBaseURL }
async function login(page: Page, db: PrismaClient) {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })
  await db.rateLimit.deleteMany({
    where: {
      key: { in: ['login:ip:unknown', 'login:email:admin@example.com', 'adminwrite:' + admin.id] },
    },
  })
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
}
async function create(
  page: Page,
  kind: '分类' | '标签',
  name: string,
  slug: string,
  parent?: string,
) {
  await page.getByRole('button', { name: '新建' + kind, exact: true }).click()
  await page.getByLabel(kind + '名称', { exact: true }).fill(name)
  await page.getByLabel(kind + 'slug', { exact: true }).fill(slug)
  // 覆盖名称拼音定时器已启动后，手动slug不能被迟到的回调覆盖。
  await page.waitForTimeout(350)
  await expect(page.getByLabel(kind + 'slug', { exact: true })).toHaveValue(slug)
  if (parent) await page.getByLabel('父分类', { exact: true }).selectOption(parent)
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/' + (kind === '分类' ? 'categories' : 'tags')) &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '保存' + kind, exact: true }).click()
  const response = await saved
  expect(response.status()).toBe(201)
  await expect(page.getByRole('status').filter({ hasText: kind + '已保存' })).toBeVisible()
  return (await response.json()).data
}

test('分类两层CRUD、同级键盘排序、父删除保护及正文脱分类闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '分类后台桌面闭环')
  const db = database(),
    prefix = '分类闭环-' + Date.now(),
    slug = 'category-e2e-' + Date.now(),
    ids: string[] = [],
    articles: string[] = []
  try {
    await page.addInitScript(() => {
      const listeners = new Set<EventListenerOrEventListenerObject>()
      const state = window as Window & { taxonomyKeyboardListeners?: number }
      state.taxonomyKeyboardListeners = 0
      const originalAdd = EventTarget.prototype.addEventListener
      const originalRemove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this === document && type === 'keydown' && listener) {
          listeners.add(listener)
          state.taxonomyKeyboardListeners = listeners.size
        }
        return originalAdd.call(this, type, listener, options)
      }
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (this === document && type === 'keydown' && listener) {
          listeners.delete(listener)
          state.taxonomyKeyboardListeners = listeners.size
        }
        return originalRemove.call(this, type, listener, options)
      }
    })
    await login(page, db)
    await page.goto('/admin/categories?q=' + encodeURIComponent(prefix))
    const first = await create(page, '分类', prefix + '-技术', slug + '-tech')
    ids.push(first.id)
    const second = await create(page, '分类', prefix + '-生活', slug + '-life')
    ids.push(second.id)
    const child = await create(page, '分类', prefix + '-前端', slug + '-front', first.id)
    ids.push(child.id)
    await expect(
      page.getByRole('button', { name: '编辑分类 ' + prefix + '-前端', exact: true }),
    ).toBeVisible()
    const handle = page.getByRole('button', { name: '拖拽分类 ' + prefix + '-生活', exact: true })
    await handle.focus()
    const listenerCount = () =>
      page.evaluate(
        () =>
          (window as Window & { taxonomyKeyboardListeners?: number }).taxonomyKeyboardListeners ??
          0,
      )
    const startSorting = async () => {
      const before = await listenerCount()
      await page.keyboard.press('Space')
      await expect(handle).toHaveAttribute('aria-pressed', 'true')
      // dnd-kit在零延迟定时器中绑定方向键，拖拽状态先于实际监听就绪。
      await expect.poll(listenerCount).toBeGreaterThan(before)
      await expect(
        page.getByRole('status').filter({ hasText: 'moved over droppable area ' + second.id }),
      ).toBeVisible()
    }
    const reordered = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/categories/reorder'),
    )
    await startSorting()
    await page.keyboard.press('ArrowUp')
    await expect(
      page.getByRole('status').filter({ hasText: 'droppable area ' + first.id }),
    ).toBeVisible()
    await page.keyboard.press('Space')
    expect((await reordered).status()).toBe(200)
    const roots = await db.category.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    })
    expect(roots.map((item) => item.id)).toEqual([second.id, first.id])
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '删除分类 ' + prefix + '-技术', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '子分类' })).toBeVisible()
    expect(await db.category.count({ where: { id: first.id } })).toBe(1)
    const article = await db.article.create({
      data: {
        title: prefix + '-正文',
        slug: slug + '-article',
        content: '分类删除不能删除正文',
        categoryId: child.id,
        status: 'DRAFT',
      },
    })
    articles.push(article.id)
    const publicTree = (await (await page.request.get('/api/v1/categories')).json()).data
    expect(JSON.stringify(publicTree)).not.toContain(child.id)
    page.once('dialog', (dialog) => dialog.accept())
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/categories/' + child.id) &&
        response.request().method() === 'DELETE',
    )
    await page.getByRole('button', { name: '删除分类 ' + prefix + '-前端', exact: true }).click()
    expect((await deleted).status()).toBe(200)
    const kept = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(kept.categoryId).toBeNull()
    expect(kept.revision).toBe(article.revision + 1)
    expect(kept.content).toBe('分类删除不能删除正文')
    await page.getByRole('button', { name: '编辑分类 ' + prefix + '-生活', exact: true }).click()
    const current = await db.category.findUniqueOrThrow({ where: { id: second.id } })
    expect(
      (
        await page.request.patch('/api/v1/admin/categories/' + second.id, {
          headers,
          data: { revision: current.revision, name: prefix + '-新生活' },
        })
      ).status(),
    ).toBe(200)
    await page.getByLabel('分类名称', { exact: true }).fill(prefix + '-不能覆盖')
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/categories/' + second.id) &&
        response.status() === 409,
    )
    await page.getByRole('button', { name: '保存分类', exact: true }).click()
    await conflict
    await expect(page.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
    await expect(page.getByLabel('分类名称', { exact: true })).toHaveValue(prefix + '-不能覆盖')
  } finally {
    await db.article.deleteMany({ where: { id: { in: articles } } })
    await db.category.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})

test('共享标签合并预览、去重、内容版本保护及批量解除关联闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '标签后台桌面闭环')
  const db = database(),
    prefix = '标签闭环-' + Date.now(),
    slug = 'tag-e2e-' + Date.now(),
    ids: string[] = [],
    articles: string[] = [],
    logs: string[] = [],
    projects: string[] = []
  try {
    await login(page, db)
    await page.goto('/admin/tags?q=' + encodeURIComponent(prefix))
    const one = await create(page, '标签', prefix + '-Next', slug + '-one')
    ids.push(one.id)
    const two = await create(page, '标签', prefix + '-React', slug + '-two')
    ids.push(two.id)
    const target = await create(page, '标签', prefix + '-目标', slug + '-target')
    ids.push(target.id)
    await expect(page.getByLabel('标签slug', { exact: true })).toHaveAttribute('readonly', '')
    const article = await db.article.create({
      data: {
        title: prefix + '文章',
        slug: slug + '-article',
        content: '共享文章正文',
        tags: { connect: [{ id: one.id }, { id: two.id }, { id: target.id }] },
      },
    })
    articles.push(article.id)
    const log = await db.log.create({
      data: {
        title: prefix + '日志',
        content: '软删日志正文',
        type: 'DAILY',
        logDate: new Date('2024-01-01'),
        deletedAt: new Date(),
        tags: { connect: [{ id: one.id }] },
      },
    })
    logs.push(log.id)
    const project = await db.project.create({
      data: {
        title: prefix + '作品',
        slug: slug + '-project',
        type: 'REPO',
        description: '未来作品正文',
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() + 86400000),
        tags: { connect: [{ id: two.id }] },
      },
    })
    projects.push(project.id)
    await page.getByRole('button', { name: '刷新列表', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: '选择标签 ' + prefix + '-Next', exact: true }),
    ).toBeEnabled()
    await page.getByRole('button', { name: '编辑标签 ' + prefix + '-Next', exact: true }).click()
    await page.getByLabel('标签名称', { exact: true }).fill(prefix + '-保留脏稿')
    await page.getByRole('checkbox', { name: '选择标签 ' + prefix + '-Next', exact: true }).check()
    await page.getByRole('checkbox', { name: '选择标签 ' + prefix + '-React', exact: true }).check()
    await page.getByRole('button', { name: '合并标签', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '合并标签', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('查找合并目标', { exact: true }).fill(prefix)
    await expect(
      dialog.getByRole('option', { name: prefix + '-目标 /' + slug + '-target', exact: true }),
    ).toBeAttached()
    await dialog.getByLabel('合并目标标签', { exact: true }).selectOption(target.id)
    const preview = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/tags/merge/preview'),
    )
    await dialog.getByRole('button', { name: '查看合并影响', exact: true }).click()
    expect((await preview).status()).toBe(200)
    await expect(dialog.getByLabel('合并影响预览')).toContainText('合计3')
    await expect(dialog.getByLabel('合并影响预览')).toContainText('新增目标关联：2')
    const merging = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/tags/merge'),
    )
    await dialog.getByRole('button', { name: '确认合并', exact: true }).click()
    expect((await merging).status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel('标签名称', { exact: true })).toHaveValue(prefix + '-保留脏稿')
    await expect(page.getByRole('heading', { name: '新建标签', exact: true })).toBeVisible()
    expect(await db.tag.count({ where: { id: { in: [one.id, two.id] } } })).toBe(0)
    for (const item of [
      await db.article.findUniqueOrThrow({ where: { id: article.id }, include: { tags: true } }),
      await db.log.findUniqueOrThrow({ where: { id: log.id }, include: { tags: true } }),
      await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { tags: true } }),
    ]) {
      expect(item.revision).toBe(2)
      expect(item.tags.map((tag) => tag.id)).toEqual([target.id])
    }
    expect(
      (
        await page.request.patch('/api/v1/admin/articles/' + article.id, {
          headers,
          data: { revision: 1, title: '禁止覆盖合并关系' },
        })
      ).status(),
    ).toBe(409)
    const publicTags = JSON.stringify((await (await page.request.get('/api/v1/tags')).json()).data)
    for (const id of ids) expect(publicTags).not.toContain(id)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '编辑标签 ' + prefix + '-目标', exact: true }).click()
    await expect(
      page.getByRole('checkbox', { name: '选择标签 ' + prefix + '-目标', exact: true }),
    ).toBeEnabled()
    await page.getByRole('checkbox', { name: '选择标签 ' + prefix + '-目标', exact: true }).check()
    page.once('dialog', (dialog) => dialog.accept())
    const deleting = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/admin/tags/bulk'),
    )
    await page.getByRole('button', { name: '批量删除', exact: true }).click()
    expect((await deleting).status()).toBe(200)
    await expect(page.getByLabel('标签名称', { exact: true })).toHaveValue('')
    expect(await db.tag.count({ where: { id: target.id } })).toBe(0)
    expect(await db.article.count({ where: { id: article.id } })).toBe(1)
    expect(await db.log.count({ where: { id: log.id } })).toBe(1)
    expect(await db.project.count({ where: { id: project.id } })).toBe(1)
  } finally {
    await db.article.deleteMany({ where: { id: { in: articles } } })
    await db.log.deleteMany({ where: { id: { in: logs } } })
    await db.project.deleteMany({ where: { id: { in: projects } } })
    await db.tag.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})

test('分类标签三端长名称、筛选分页和标签云可用', async ({ page }, info) => {
  const db = database()
  const prefix = '三端分类标签-' + Date.now()
  const ids: string[] = []
  let categoryId = ''
  try {
    await login(page, db)
    const category = await db.category.create({
      data: { name: prefix + '长'.repeat(160), slug: 'responsive-category-' + Date.now() },
    })
    categoryId = category.id
    for (let index = 0; index < 12; index++) {
      const tag = await db.tag.create({
        data: {
          name: prefix + '-' + index + '长'.repeat(150),
          slug: 'responsive-tag-' + Date.now() + '-' + index,
        },
      })
      ids.push(tag.id)
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.goto('/admin/categories?q=' + encodeURIComponent(prefix))
    await expect(
      page.getByRole('button', { name: '编辑分类 ' + category.name, exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.goto('/admin/tags?q=' + encodeURIComponent(prefix) + '&pageSize=10')
    await expect(page.getByRole('checkbox', { name: /^选择标签 / })).toHaveCount(10)
    await page
      .getByRole('checkbox', { name: /^选择标签 / })
      .first()
      .check()
    await expect(page.getByRole('button', { name: '合并标签', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByRole('checkbox', { name: /^选择标签 / })).toHaveCount(2)
    await expect(page.getByRole('button', { name: '合并标签', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '标签云', exact: true }).click()
    await expect(page.getByRole('button', { name: '切回表格', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/taxonomy-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    await page.getByRole('button', { name: '切回表格', exact: true }).click()
    for (const checkbox of await page.getByRole('checkbox', { name: /^选择标签 / }).all())
      await checkbox.check()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '批量删除', exact: true }).click()
    await expect(page).toHaveURL(/page=1/)
    await expect(page.getByRole('checkbox', { name: /^选择标签 / })).toHaveCount(10)
  } finally {
    await db.tag.deleteMany({ where: { id: { in: ids } } })
    if (categoryId) await db.category.deleteMany({ where: { id: categoryId } })
    await db.$disconnect()
  }
})

test('标签手动slug、重复提示及后退取消保留表单', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '后台未保存与冲突保护')
  const db = database()
  const slug = 'slug-guard-' + Date.now()
  let id = ''
  try {
    await login(page, db)
    await page.getByRole('link', { name: '标签', exact: true }).click()
    await expect(page).toHaveURL('/admin/tags')
    const existing = await db.tag.create({ data: { name: '重复slug夹具', slug } })
    id = existing.id
    await expect(page.getByLabel('标签名称', { exact: true })).toBeEnabled()
    await page.getByLabel('标签名称', { exact: true }).fill('尚未保存标签')
    await page.getByLabel('标签slug', { exact: true }).fill(slug)
    await page.waitForTimeout(350)
    await expect(page.getByLabel('标签slug', { exact: true })).toHaveValue(slug)
    const duplicate = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/admin/tags') && response.status() === 409,
    )
    await page.getByRole('button', { name: '保存标签', exact: true }).click()
    await duplicate
    await expect(page.getByRole('alert').filter({ hasText: 'slug已被使用' })).toHaveText(
      'slug已被使用',
    )
    const cancelled = page
      .waitForEvent('dialog', { timeout: 5000 })
      .then((dialog) => dialog.dismiss())
    await page.evaluate(() => history.back())
    await cancelled
    await expect(page).toHaveURL('/admin/tags')
    await expect(page.getByLabel('标签名称', { exact: true })).toHaveValue('尚未保存标签')
    // 修改再撤回到初始空表单，不得在下一次进入时复活已撤销快照。
    await page.getByLabel('标签名称', { exact: true }).fill('')
    await page.getByLabel('标签slug', { exact: true }).fill('')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((key) => key.startsWith('taxonomy-draft:tags:'))
              .length,
        ),
      )
      .toBe(0)
    await page.getByRole('link', { name: '仪表盘', exact: true }).click()
    await page.getByRole('link', { name: '标签', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复未保存表单', exact: true })).toHaveCount(0)
  } finally {
    if (id) await db.tag.deleteMany({ where: { id } })
    await db.$disconnect()
  }
})

test('无Navigation API历史离开降级恢复且保留旧revision', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '历史导航降级与旧稿冲突')
  const db = database()
  const prefix = '降级标签-' + Date.now()
  let id = ''
  try {
    await page.addInitScript(() =>
      Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
    )
    await login(page, db)
    const item = await db.tag.create({ data: { name: prefix, slug: 'fallback-tag-' + Date.now() } })
    id = item.id
    await page.getByRole('link', { name: '标签', exact: true }).click()
    await page.getByRole('button', { name: '编辑标签 ' + prefix, exact: true }).click()
    await page.getByLabel('标签名称', { exact: true }).fill(prefix + '-本地稿')
    await page.evaluate(() => history.back())
    await expect(page).toHaveURL('/admin')
    await page.getByRole('link', { name: '标签', exact: true }).click()
    await page.getByRole('button', { name: '恢复未保存表单', exact: true }).click()
    await expect(page.getByLabel('标签名称', { exact: true })).toHaveValue(prefix + '-本地稿')
    expect(
      (
        await page.request.patch('/api/v1/admin/tags/' + id, {
          headers,
          data: { revision: 1, name: prefix + '-新版' },
        })
      ).status(),
    ).toBe(200)
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/tags/' + id) && response.status() === 409,
    )
    await page.getByRole('button', { name: '保存标签', exact: true }).click()
    await conflict
    await expect(page.getByLabel('标签名称', { exact: true })).toHaveValue(prefix + '-本地稿')
  } finally {
    if (id) await db.tag.deleteMany({ where: { id } })
    await db.$disconnect()
  }
})
