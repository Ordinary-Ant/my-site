import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'

const password = 'RoleBrowserPass123'
const adminLinks = ['模块开关', '站点设置', '动效设置', '用户管理', '数据管理']

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
  const run = randomUUID()
  const emails = [`e2e-editor-${run}@example.com`, `e2e-viewer-${run}@example.com`]
  const userIds: string[] = []
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
    const headers = { Origin: testInfo.project.use.baseURL ?? 'http://localhost:3000' }
    const editorContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
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

    const viewerContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
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
  } finally {
    // 先关闭浏览器，防止编辑器卸载保存与fixture清理竞争；只删除本次账户及关联内容。
    for (const context of contexts) await context.close()
    try {
      const articles = await db.article.findMany({
        where: { authorId: { in: userIds } },
        select: { id: true },
      })
      await db.previewToken.deleteMany({
        where: { kind: 'article', contentId: { in: articles.map((article) => article.id) } },
      })
      await db.auditLog.deleteMany({ where: { userId: { in: userIds } } })
      await db.article.deleteMany({ where: { authorId: { in: userIds } } })
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
