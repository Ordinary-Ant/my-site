import { testBaseURL } from './base-url'
import { PrismaClient } from '@prisma/client'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
const headers = { Origin: testBaseURL }
function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('只允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
async function login(
  page: Page,
  db: PrismaClient,
  email = 'admin@example.com',
  password = 'ChangeMe123',
) {
  const current = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
  if (!current[0]?.name.endsWith('_test')) throw new Error('实际数据库不是独立测试库')
  await db.rateLimit.deleteMany({
    where: { key: { in: ['login:ip:unknown', 'login:email:' + email] } },
  })
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
}
async function confirmed(page: Page, action: () => Promise<unknown>) {
  page.once('dialog', (dialog) => dialog.accept())
  await action()
}
async function save(page: Page, id: string, confirm = false) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/users/' + id) &&
      response.request().method() === 'PATCH',
  )
  const click = () => page.getByRole('button', { name: '保存用户', exact: true }).click()
  if (confirm) await confirmed(page, click)
  else await click()
  return pending
}
async function closeSecret(page: Page, escape = false) {
  const password = await page.getByLabel('临时密码', { exact: true }).inputValue()
  expect(
    /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /\d/.test(password) &&
      password.length >= 24,
  ).toBe(true)
  const persisted = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  )
  expect(persisted.includes(password)).toBe(false)
  if (escape) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: '复制密码', exact: true }).click()
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
    expect(
      await page.evaluate(
        async (value) => (await navigator.clipboard.readText()) === value,
        password,
      ),
    ).toBe(true)
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await page.keyboard.press('Escape')
  } else await page.getByRole('button', { name: '关闭并清除', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '临时密码仅展示一次', exact: true })).toBeHidden()
  await expect
    .poll(
      async () => (await page.getByLabel('临时密码', { exact: true }).inputValue()).length === 0,
    )
    .toBe(true)
  return password
}
test('用户真实创建登录、版本冲突、角色停用重置与会话撤销闭环', async ({ page, browser }, info) => {
  test.skip(info.project.name !== '1440', '完整账号生命周期在独立测试库桌面验收')
  test.setTimeout(120000)
  const db = database(),
    contexts: BrowserContext[] = []
  let id: string | null = null
  try {
    await login(page, db)
    const actor = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })
    await db.rateLimit.deleteMany({ where: { key: 'adminwrite:' + actor.id } })
    await page.goto('/admin/users')
    const run = Date.now(),
      email = 'users-browser-' + run + '@example.com'
    await page.getByLabel('用户姓名', { exact: true }).fill('流程用户' + run)
    await page.getByLabel('用户邮箱', { exact: true }).fill(email)
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/users') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '创建用户', exact: true }).click()
    const created = await creation
    expect(created.status()).toBe(201)
    const result = (await created.json()).data
    id = result.user.id
    expect(Object.hasOwn(result.user, 'passwordHash')).toBe(false)
    const password = await closeSecret(page, true)
    const context = await browser.newContext({ baseURL: testBaseURL })
    contexts.push(context)
    const account = await context.newPage()
    await login(account, db, email, password)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(200)
    expect((await account.request.get('/api/v1/admin/users')).status()).toBe(403)
    await page.getByLabel('筛选用户', { exact: true }).fill(email)
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(email)
    await expect(page.getByRole('button', { name: '编辑用户 ' + email, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '编辑用户 ' + email, exact: true }).click()
    await page.getByLabel('用户姓名', { exact: true }).fill('本地待保存修改')
    await db.user.update({
      where: { id: id! },
      data: { name: '另一管理员修改', revision: { increment: 1 } },
    })
    expect((await save(page, id!)).status()).toBe(409)
    await expect(page.getByLabel('用户姓名', { exact: true })).toHaveValue('本地待保存修改')
    await confirmed(page, () =>
      page.getByRole('button', { name: '加载最新资料', exact: true }).click(),
    )
    await expect(page.getByLabel('用户姓名', { exact: true })).toHaveValue('另一管理员修改')
    await page.getByLabel('用户姓名', { exact: true }).fill('名称修改不撤销会话')
    await page.getByLabel('用户头像地址', { exact: true }).fill('https://example.com/avatar.png')
    // 延迟真实写响应，确认保存完成按当前筛选刷新，不能用旧查询覆盖列表。
    let release!: () => void, reached!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const writing = new Promise<void>((resolve) => {
      reached = resolve
    })
    const endpoint = '**/api/v1/admin/users/' + id
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      const response = await route.fetch()
      reached()
      await gate
      await route.fulfill({ response })
    })
    try {
      const pending = save(page, id!)
      await writing
      await expect(page.getByRole('button', { name: '正在处理…', exact: true })).toBeDisabled()
      await page.getByLabel('筛选用户角色', { exact: true }).selectOption('VIEWER')
      await expect(page).toHaveURL(/role=VIEWER/)
      await expect(page.getByText('没有匹配用户。', { exact: true })).toBeVisible()
      const refreshed = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/admin/users?') && response.request().method() === 'GET',
      )
      release()
      expect((await pending).status()).toBe(200)
      const refresh = await refreshed
      expect(new URL(refresh.url()).searchParams.get('role')).toBe('VIEWER')
      await expect(page.getByText('用户资料已保存。', { exact: true })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: '共0位用户' })).toBeVisible()
      await expect(
        page.getByRole('button', { name: '编辑用户 ' + email, exact: true }),
      ).toHaveCount(0)
    } finally {
      release()
      await page.unrouteAll({ behavior: 'wait' })
    }
    await page.getByLabel('筛选用户角色', { exact: true }).selectOption('')
    await expect(page.getByRole('button', { name: '编辑用户 ' + email, exact: true })).toBeVisible()
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(200)
    await page.getByLabel('用户角色', { exact: true }).selectOption('VIEWER')
    expect((await save(page, id!, true)).status()).toBe(200)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(401)
    await login(account, db, email, password)
    expect(
      (await account.request.post('/api/v1/admin/users', { headers, data: {} })).status(),
    ).toBe(403)
    const reset = page.waitForResponse(
      (response) =>
        response.url().endsWith('/reset-password') && response.request().method() === 'POST',
    )
    await confirmed(page, () => page.getByRole('button', { name: '重置密码', exact: true }).click())
    expect((await reset).status()).toBe(200)
    const newPassword = await closeSecret(page)
    expect(newPassword !== password).toBe(true)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(401)
    expect(
      (
        await account.request.post('/api/v1/auth/login', { headers, data: { email, password } })
      ).status(),
    ).toBe(401)
    await login(account, db, email, newPassword)
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith('/revoke-sessions') && response.request().method() === 'POST',
    )
    await confirmed(page, () =>
      page.getByRole('button', { name: '撤销全部会话', exact: true }).click(),
    )
    expect((await revoked).status()).toBe(200)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(401)
    await login(account, db, email, newPassword)
    await page.getByLabel('启用用户', { exact: true }).uncheck()
    expect((await save(page, id!, true)).status()).toBe(200)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(401)
    expect(
      (
        await account.request.post('/api/v1/auth/login', {
          headers,
          data: { email, password: newPassword },
        })
      ).status(),
    ).toBe(403)
    await page.getByLabel('启用用户', { exact: true }).check()
    expect((await save(page, id!)).status()).toBe(200)
    await login(account, db, email, newPassword)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(200)
    const changedEmail = email.replace('@', '-changed@')
    await page.getByLabel('用户邮箱', { exact: true }).fill(changedEmail)
    expect((await save(page, id!, true)).status()).toBe(200)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(401)
    expect(
      (
        await account.request.post('/api/v1/auth/login', {
          headers,
          data: { email, password: newPassword },
        })
      ).status(),
    ).toBe(401)
    await login(account, db, changedEmail, newPassword)
    expect((await account.request.get('/api/v1/auth/me')).status()).toBe(200)
    expect((await db.user.findUniqueOrThrow({ where: { id: id! } })).avatar).toBe(
      'https://example.com/avatar.png',
    )
    await page.getByLabel('筛选用户', { exact: true }).fill('admin@example.com')
    await page.getByRole('button', { name: '编辑用户 admin@example.com', exact: true }).click()
    await expect(page.getByLabel('用户角色', { exact: true })).toBeDisabled()
    await expect(page.getByLabel('启用用户', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '重置密码', exact: true })).toHaveCount(0)
    const current = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
    expect(
      (
        await page.request.patch('/api/v1/admin/users/' + actor.id, {
          headers,
          data: { revision: current.revision, isActive: false },
        })
      ).status(),
    ).toBe(422)
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.id } })).isActive).toBe(true)
  } finally {
    for (const context of contexts) await context.close()
    if (id) {
      await db.auditLog.deleteMany({
        where: { OR: [{ userId: id }, { resource: 'user', resourceId: id }] },
      })
      await db.rateLimit.deleteMany({
        where: {
          OR: [{ key: 'adminwrite:' + id }, { key: { startsWith: 'login:email:users-browser-' } }],
        },
      })
      await db.user.delete({ where: { id } })
    }
    await db.$disconnect()
  }
})
test('用户管理三端筛选分页、自己保护、未保存取消与暗色键盘布局', async ({ page }, info) => {
  const db = database(),
    ids: string[] = []
  try {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await login(page, db)
    const run = 'layout-' + Date.now()
    for (let index = 0; index < 12; index++)
      ids.push(
        (
          await db.user.create({
            data: {
              name: run + '-' + index + '长名称'.repeat(55),
              email: run + '-' + index + '@example.com',
              passwordHash: 'never-used-browser-layout',
              role: 'VIEWER',
            },
          })
        ).id,
      )
    await page.goto('/admin/users?q=' + run + '&pageSize=10')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('status').filter({ hasText: '共12位用户' })).toBeVisible()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await page.reload()
    await expect(page.getByText('第2 / 2页', { exact: true })).toBeVisible()
    await page.getByLabel('用户姓名', { exact: true }).fill('未保存资料')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('navigation', { name: '管理导航' })
      .getByRole('link', { name: '文章', exact: true })
      .click()
    await expect(page).toHaveURL(/\/admin\/users/)
    await expect(page.getByLabel('用户姓名', { exact: true })).toHaveValue('未保存资料')
    await confirmed(page, () => page.getByRole('button', { name: '放弃修改', exact: true }).click())
    await page.getByLabel('筛选用户角色', { exact: true }).focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await page.getByLabel('筛选用户角色', { exact: true }).selectOption('VIEWER')
    await expect(page).toHaveURL(/role=VIEWER/)
    await page.getByLabel('筛选用户状态', { exact: true }).selectOption('false')
    await expect(page.getByText('没有匹配用户。', { exact: true })).toBeVisible()
    await page.getByLabel('筛选用户状态', { exact: true }).selectOption('true')
    await expect(page.getByRole('status').filter({ hasText: '共12位用户' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/users-dark-' + info.project.name + '.png',
      fullPage: true,
    })
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } })
    await db.$disconnect()
  }
})
