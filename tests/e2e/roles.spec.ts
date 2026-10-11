import { testBaseURL } from './base-url'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'

const password = 'RoleBrowserPass123'
const adminLinks = ['模块开关', '站点设置', '动效设置', '用户管理', '数据管理']

async function usersForbidden(page: Page, id: string, headers: Record<string, string>) {
  await page.goto('/admin/users')
  await expect(page.getByText('仅管理员可以管理用户。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('用户姓名', { exact: true })).toHaveCount(0)
  expect((await page.request.get('/api/v1/admin/users')).status()).toBe(403)
  expect((await page.request.post('/api/v1/admin/users', { headers, data: {} })).status()).toBe(403)
  expect(
    (await page.request.patch('/api/v1/admin/users/' + id, { headers, data: {} })).status(),
  ).toBe(403)
  for (const action of ['reset-password', 'revoke-sessions'])
    expect(
      (
        await page.request.post('/api/v1/admin/users/' + id + '/' + action, { headers, data: {} })
      ).status(),
    ).toBe(403)
}

async function login(page: Page, email: string, role: string) {
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  await expect(
    page.locator('header').getByText(`角色验收 · ${role}`, { exact: true }),
  ).toBeVisible()
  const me = await page.request.get('/api/v1/auth/me')
  expect(me.status()).toBe(200)
  expect((await me.json()).data.role).toBe(role)
}

test('EDITOR可编辑且无管理员入口，VIEWER列表与正文只读，越权API返回403', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '三角色权限仅在桌面视口验收')
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('拒绝操作非独立测试库')
  if (testInfo.config.workers !== 1) throw new Error('角色验收必须单worker，避免共享登录桶竞争')
  const db = new PrismaClient({ datasources: { db: { url } } })
  const originalProfile = await db.profile.findUniqueOrThrow({ where: { id: 'default' } })
  const run = randomUUID()
  const emails = [`e2e-editor-${run}@example.com`, `e2e-viewer-${run}@example.com`]
  const userIds: string[] = []
  const projectIds: string[] = []
  const timelineIds: string[] = []
  const categoryIds: string[] = []
  const tagIds: string[] = []
  const contexts = []
  try {
    const databases = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
    if (!databases[0]?.name.endsWith('_test')) throw new Error('实际数据库不是独立测试库')
    // 仅独立_test库清理未知IP登录桶，生产限流合同保持不变。
    await db.rateLimit.deleteMany({ where: { key: 'login:ip:unknown' } })
    const passwordHash = await bcrypt.hash(password, 10)
    for (const [index, role] of (['EDITOR', 'VIEWER'] as const).entries()) {
      const user = await db.user.create({
        data: { email: emails[index], passwordHash, name: '角色验收', role },
      })
      userIds.push(user.id)
    }
    const fixture = await db.article.create({
      data: {
        title: `只读验收-${run}`,
        slug: `readonly-${run}`,
        content: 'VIEWER可以读取这段正文，但不能修改。',
        authorId: userIds[0],
      },
    })
    const headers = { Origin: testInfo.project.use.baseURL ?? testBaseURL }
    const log = await db.log.create({
      data: {
        title: '日志角色验收-' + run,
        content: '日志角色正文',
        type: 'DAILY',
        logDate: new Date('2025-01-15'),
        status: 'DRAFT',
        authorId: userIds[0],
      },
    })
    const project = await db.project.create({
      data: {
        title: '作品角色验收-' + run,
        slug: 'project-role-' + run,
        type: 'REPO',
        description: '角色作品简介',
        content: '作品角色正文',
        status: 'DRAFT',
      },
    })
    projectIds.push(project.id)
    const timeline = await db.timelineItem.create({
      data: {
        title: '经历角色验收-' + run,
        type: 'WORK',
        startDate: new Date('2020-01-01'),
        startPrecision: 'YEAR',
        description: '经历角色正文',
        visible: false,
        showOnAbout: false,
      },
    })
    timelineIds.push(timeline.id)
    const editorContext = await browser.newContext({ baseURL: testBaseURL })
    contexts.push(editorContext)
    const editor = await editorContext.newPage()
    await login(editor, emails[0], 'EDITOR')
    const editorNav = editor.getByRole('navigation', { name: '管理导航' })
    for (const name of [...adminLinks, '审计日志'])
      await expect(editorNav.getByRole('link', { name, exact: true })).toHaveCount(0)
    await editorNav.getByRole('link', { name: '文章', exact: true }).click()
    await expect(editor.getByRole('heading', { name: '文章管理', exact: true })).toBeVisible()
    await editor.getByRole('link', { name: '新建文章 +', exact: true }).click()
    const title = `编辑角色验收-${run}`
    await editor.getByLabel('文章标题', { exact: true }).fill(title)
    await editor.getByLabel('正文', { exact: true }).fill('EDITOR首次保存正文。')
    const createdResponse = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/articles') && response.request().method() === 'POST',
    )
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
    const created = await createdResponse
    expect(created.status()).toBe(201)
    const article = (await created.json()).data
    await expect(editor).toHaveURL(`/admin/articles/${article.id}`)
    await expect(editor.getByRole('status')).toContainText('保存成功')
    await editor.getByLabel('正文', { exact: true }).fill('EDITOR修改后保存正文。')
    const updatedResponse = editor.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/admin/articles/${article.id}`) &&
        response.request().method() === 'PATCH',
    )
    await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
    const updated = await updatedResponse
    expect(updated.status()).toBe(200)
    expect((await updated.json()).data.content).toBe('EDITOR修改后保存正文。')
    expect(
      (
        await editor.request.delete(`/api/v1/admin/articles/${article.id}/purge`, {
          headers,
          data: { revision: 2 },
        })
      ).status(),
    ).toBe(403)
    await editor.screenshot({ path: testInfo.outputPath('editor-writable.png'), fullPage: true })
    await editor.goto('/admin/logs/' + log.id)
    await editor.getByLabel('正文', { exact: true }).fill('EDITOR日志保存正文')
    const logSaved = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/logs/' + log.id) &&
        response.request().method() === 'PATCH',
    )
    await editor.getByRole('button', { name: '保存日志', exact: true }).click()
    expect((await logSaved).status()).toBe(200)
    await expect(editor.getByRole('status')).toHaveText('日志已保存')
    expect(
      (
        await editor.request.delete('/api/v1/admin/logs/' + log.id + '/purge', {
          headers,
          data: { revision: 2 },
        })
      ).status(),
    ).toBe(403)

    await editor.goto('/admin/projects/' + project.id)
    await editor.getByLabel('一句话亮点', { exact: true }).fill('EDITOR作品修改')
    const projectSaved = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/projects/' + project.id) &&
        response.request().method() === 'PATCH',
    )
    await editor.getByRole('button', { name: '保存作品', exact: true }).click()
    expect((await projectSaved).status()).toBe(200)
    await expect(editor.getByRole('status')).toHaveText('作品已保存')
    expect(
      (
        await editor.request.delete('/api/v1/admin/projects/' + project.id + '/purge', {
          headers,
          data: { revision: 2 },
        })
      ).status(),
    ).toBe(403)
    await editor.goto('/admin/timeline/' + timeline.id)
    await editor.getByLabel('关键成果', { exact: true }).fill('EDITOR经历修改')
    const timelineSaved = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/timeline/' + timeline.id) &&
        response.request().method() === 'PATCH',
    )
    await editor.getByRole('button', { name: '保存经历', exact: true }).click()
    expect((await timelineSaved).status()).toBe(200)
    await expect(editor.getByRole('status')).toHaveText('经历已保存')
    expect(
      (
        await editor.request.delete('/api/v1/admin/timeline/' + timeline.id + '/purge', {
          headers,
          data: { revision: 2 },
        })
      ).status(),
    ).toBe(403)
    await editor.goto('/admin/profile')
    await expect(editor.getByLabel('姓名', { exact: true })).toBeEnabled()
    await editor.getByLabel('一句话定位', { exact: true }).fill('EDITOR资料定位-' + run)
    const profileSave = editor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/profile') && response.request().method() === 'PATCH',
    )
    await editor.getByRole('button', { name: '保存资料', exact: true }).click()
    expect((await profileSave).status()).toBe(200)
    for (const kind of ['categories', 'tags'] as const) {
      const label = kind === 'categories' ? '分类' : '标签'
      await editor.goto('/admin/' + kind)
      await expect(editor.getByLabel(label + '名称', { exact: true })).toBeEnabled()
      await editor.getByLabel(label + '名称', { exact: true }).fill('角色' + label + run)
      await editor.getByLabel(label + 'slug', { exact: true }).fill('role-' + kind + '-' + run)
      const response = editor.waitForResponse(
        (item) =>
          item.url().endsWith('/api/v1/admin/' + kind) && item.request().method() === 'POST',
      )
      await editor.getByRole('button', { name: '保存' + label, exact: true }).click()
      const result = await response
      expect(result.status()).toBe(201)
      const created = (await result.json()).data
      ;(kind === 'categories' ? categoryIds : tagIds).push(created.id)
    }
    await editor.goto('/admin/data')
    await expect(
      editor.getByText('仅管理员可以导入或导出站点数据。', { exact: true }),
    ).toBeVisible()
    await expect(editor.getByRole('button', { name: '下载全站JSON', exact: true })).toHaveCount(0)
    expect((await editor.request.get('/api/v1/admin/export')).status()).toBe(403)
    for (const endpoint of ['/api/v1/admin/import/preview', '/api/v1/admin/import'])
      expect((await editor.request.post(endpoint, { headers, data: {} })).status()).toBe(403)
    await usersForbidden(editor, userIds[1], headers)
    await editor.goto('/admin/media')
    await expect(editor.getByLabel('上传文件', { exact: true })).toBeEnabled()
    await editor.goto('/admin/settings/general')
    await expect(editor.getByLabel('站点名称', { exact: true })).toBeDisabled()
    await expect(editor.getByRole('button', { name: '保存设置', exact: true })).toHaveCount(0)
    const viewerContext = await browser.newContext({ baseURL: testBaseURL })
    contexts.push(viewerContext)
    const viewer = await viewerContext.newPage()
    await login(viewer, emails[1], 'VIEWER')
    const viewerNav = viewer.getByRole('navigation', { name: '管理导航' })
    for (const name of adminLinks)
      await expect(viewerNav.getByRole('link', { name, exact: true })).toHaveCount(0)
    await expect(viewerNav.getByRole('link', { name: '审计日志', exact: true })).toBeVisible()
    await viewerNav.getByRole('link', { name: '文章', exact: true }).click()
    await viewer.getByLabel('筛选文章').fill(fixture.title)
    await expect(viewer.getByRole('link', { name: fixture.title, exact: true })).toBeVisible()
    await expect(viewer.getByRole('link', { name: '新建文章 +', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('link', { name: '编辑', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
    await viewer.getByRole('link', { name: fixture.title, exact: true }).click()
    await expect(viewer.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible()
    await expect(viewer.getByLabel('只读正文', { exact: true })).toHaveValue(fixture.content)
    await expect(viewer.getByLabel('只读正文', { exact: true })).toHaveAttribute('readonly', '')
    await expect(viewer.getByLabel('文章标题', { exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '发布文章', exact: true })).toHaveCount(0)
    await viewer.screenshot({ path: testInfo.outputPath('viewer-readonly.png'), fullPage: true })
    expect(
      (
        await viewer.request.post('/api/v1/admin/articles', {
          headers,
          data: { title: '禁止创建', content: '禁止创建正文' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await viewer.request.patch(`/api/v1/admin/articles/${fixture.id}`, {
          headers,
          data: { revision: 1, content: '禁止修改正文' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await viewer.request.delete(`/api/v1/admin/articles/${fixture.id}`, {
          headers,
          data: { revision: 1 },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await viewer.request.post(`/api/v1/admin/articles/${fixture.id}/preview-token`, {
          headers,
        })
      ).status(),
    ).toBe(403)
    await viewer.goto('/admin/articles/new')
    await expect(viewer.getByRole('heading', { name: '只读访问', exact: true })).toBeVisible()
    await expect(viewer.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0)
    expect(await db.article.findUnique({ where: { id: fixture.id } })).toMatchObject({
      content: fixture.content,
      revision: 1,
      deletedAt: null,
    })
    await viewer.goto('/admin/logs?view=list&q=' + encodeURIComponent(log.title))
    await expect(viewer.getByRole('link', { name: log.title, exact: true })).toBeVisible()
    await expect(viewer.getByRole('button', { name: '记一笔', exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '移入回收站', exact: true })).toHaveCount(0)
    await viewer.getByRole('link', { name: log.title, exact: true }).click()
    await expect(viewer.getByLabel('正文', { exact: true })).toHaveValue('EDITOR日志保存正文')
    await expect(viewer.getByLabel('正文', { exact: true })).toHaveAttribute('readonly', '')
    await expect(viewer.getByLabel('标题', { exact: true })).toBeDisabled()
    await expect(viewer.getByRole('button', { name: '保存日志', exact: true })).toHaveCount(0)
    expect(
      (
        await viewer.request.patch('/api/v1/admin/logs/' + log.id, {
          headers,
          data: { revision: 2, content: '禁止覆盖' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await viewer.request.post('/api/v1/admin/logs/' + log.id + '/preview-token', { headers })
      ).status(),
    ).toBe(200)
    await viewer.goto('/admin/projects/' + project.id)
    await expect(viewer.getByLabel('作品标题', { exact: true })).toBeDisabled()
    await expect(viewer.getByLabel('只读作品正文', { exact: true })).toHaveValue('作品角色正文')
    await expect(viewer.getByLabel('只读作品正文', { exact: true })).toBeEnabled()
    await expect(viewer.getByRole('button', { name: '保存作品', exact: true })).toHaveCount(0)
    expect(
      (
        await viewer.request.patch('/api/v1/admin/projects/' + project.id, {
          headers,
          data: { revision: 2, description: '禁止覆盖' },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await viewer.request.post('/api/v1/admin/projects/' + project.id + '/preview-token', {
          headers,
        })
      ).status(),
    ).toBe(200)
    await viewer.goto('/admin/timeline/' + timeline.id)
    await expect(viewer.getByLabel('经历标题', { exact: true })).toBeDisabled()
    await expect(viewer.getByLabel('只读经历正文', { exact: true })).toBeEnabled()
    await expect(viewer.getByLabel('只读经历正文', { exact: true })).toHaveValue('经历角色正文')
    await expect(viewer.getByRole('button', { name: '保存经历', exact: true })).toHaveCount(0)
    expect(
      (
        await viewer.request.patch('/api/v1/admin/timeline/' + timeline.id, {
          headers,
          data: { revision: 2, title: '禁止修改' },
        })
      ).status(),
    ).toBe(403)
    await viewer.goto('/admin/profile')
    await expect(viewer.getByLabel('姓名', { exact: true })).toBeDisabled()
    await expect(viewer.getByLabel('正文', { exact: true })).toBeEnabled()
    await expect(viewer.getByLabel('正文', { exact: true })).toHaveValue(originalProfile.bio)
    await expect(viewer.getByRole('button', { name: '保存资料', exact: true })).toHaveCount(0)
    expect(
      (
        await viewer.request.patch('/api/v1/admin/profile', {
          headers,
          data: { revision: originalProfile.revision + 1, headline: '禁止资料修改' },
        })
      ).status(),
    ).toBe(403)
    for (const kind of ['categories', 'tags'] as const) {
      const label = kind === 'categories' ? '分类' : '标签'
      await viewer.goto('/admin/' + kind)
      await expect(viewer.getByLabel(label + '名称', { exact: true })).toBeDisabled()
      await expect(viewer.getByRole('button', { name: '保存' + label, exact: true })).toHaveCount(0)
      await expect(viewer.getByRole('button', { name: '新建' + label, exact: true })).toHaveCount(0)
      expect(
        (
          await viewer.request.post('/api/v1/admin/' + kind, {
            headers,
            data: { name: '禁止创建', slug: 'forbidden-' + run },
          })
        ).status(),
      ).toBe(403)
    }
    await viewer.goto('/admin/data')
    await expect(
      viewer.getByText('仅管理员可以导入或导出站点数据。', { exact: true }),
    ).toBeVisible()
    await expect(viewer.getByLabel('选择JSON导出文件', { exact: true })).toHaveCount(0)
    expect((await viewer.request.get('/api/v1/admin/export')).status()).toBe(403)
    for (const endpoint of ['/api/v1/admin/import/preview', '/api/v1/admin/import'])
      expect((await viewer.request.post(endpoint, { headers, data: {} })).status()).toBe(403)
    await usersForbidden(viewer, userIds[0], headers)
    await viewer.goto('/admin/media')
    await expect(viewer.getByLabel('上传文件', { exact: true })).toHaveCount(0)
    await expect(viewer.getByRole('button', { name: '新建目录', exact: true })).toHaveCount(0)
    expect((await viewer.request.get('/api/v1/admin/media/folders')).status()).toBe(200)
    for (const endpoint of ['folders', 'deduplicate'])
      expect(
        (
          await viewer.request.post('/api/v1/admin/media/' + endpoint, { headers, data: {} })
        ).status(),
      ).toBe(403)
    await viewer.goto('/admin/settings/general')
    await expect(viewer.getByLabel('站点名称', { exact: true })).toBeDisabled()
    await expect(viewer.getByRole('button', { name: '保存设置', exact: true })).toHaveCount(0)
  } finally {
    // 先关闭浏览器，防止编辑器卸载保存与fixture清理竞争；只删除本次账户及关联内容。
    for (const context of contexts) await context.close()
    await db.category.deleteMany({ where: { id: { in: categoryIds } } })
    await db.tag.deleteMany({ where: { id: { in: tagIds } } })
    try {
      await db.profile.update({
        where: { id: 'default' },
        data: {
          headline: originalProfile.headline,
          revision: originalProfile.revision,
          updatedAt: originalProfile.updatedAt,
        },
      })
      const articles = await db.article.findMany({
        where: { authorId: { in: userIds } },
        select: { id: true },
      })
      await db.previewToken.deleteMany({
        where: { kind: 'article', contentId: { in: articles.map((article) => article.id) } },
      })
      await db.auditLog.deleteMany({ where: { userId: { in: userIds } } })
      await db.article.deleteMany({ where: { authorId: { in: userIds } } })
      const logs = await db.log.findMany({
        where: { authorId: { in: userIds } },
        select: { id: true },
      })
      await db.previewToken.deleteMany({
        where: { kind: 'log', contentId: { in: logs.map((log) => log.id) } },
      })
      await db.log.deleteMany({ where: { authorId: { in: userIds } } })
      const projects = await db.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true },
      })
      await db.previewToken.deleteMany({
        where: { kind: 'project', contentId: { in: projects.map((project) => project.id) } },
      })
      await db.project.deleteMany({ where: { id: { in: projectIds } } })
      await db.timelineItem.deleteMany({ where: { id: { in: timelineIds } } })
      await db.user.deleteMany({ where: { id: { in: userIds } } })
      await db.rateLimit.deleteMany({
        where: {
          key: {
            in: [
              ...emails.map((email) => `login:email:${email}`),
              ...userIds.flatMap((id) => [`authwrite:${id}`, `adminwrite:${id}`]),
            ],
          },
        },
      })
    } finally {
      await db.$disconnect()
    }
  }
})
