import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
test('后台登录→新建草稿→预览→发布→阅读→删除→恢复', async ({ page, browser }, testInfo) => {
  const title = `闭环验收-${Date.now()}`
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  await page.goto('/admin/articles/new')
  await page.getByLabel('文章标题', { exact: true }).fill(title)
  const sample =
    '## 标题\n\n**粗体**与*斜体*及~~删除~~和`代码`。\n\n- 外层\n  - 内层\n\n1. 有序\n2. 列表\n\n- [x] 已完成\n- [ ] 未完成\n\n> 引用内容\n\n| 列A | 列B |\n| --- | --- |\n| 值1 | 值2 |\n\n```typescript\nconst value = 1\n```\n\n![图片描述](/test-image.png)\n\n[安全链接](https://example.com)'
  await page.getByLabel('正文', { exact: true }).fill(sample)
  await page.getByRole('button', { name: '所见即所得', exact: true }).click()
  await expect(page.locator('.tiptap')).toBeVisible()
  await page.getByRole('button', { name: 'Markdown 源码', exact: true }).click()
  const roundtrip = await page.getByLabel('正文', { exact: true }).inputValue()
  for (const preserved of [
    '## 标题',
    '**粗体**',
    '~~删除~~',
    '`代码`',
    '- [x]',
    '- [ ]',
    '内层',
    '列A',
    'typescript',
    '图片描述',
    'https://example.com',
  ])
    expect(roundtrip).toContain(preserved)
  await page
    .getByLabel('正文', { exact: true })
    .fill(
      '## 阅读测试\n\n这是**真实正文**。\n\n```typescript\nconst result = 42\n```\n\n:::tip[提示]\n保留扩展结构\n:::',
    )
  await expect(page.getByRole('button', { name: '所见即所得', exact: true })).toBeDisabled()
  const image = await sharp({
    create: {
      width: 3,
      height: 3,
      channels: 4,
      background: {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
        alpha: 1,
      },
    },
  })
    .png()
    .toBuffer()
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/media/upload') &&
      response.request().method() === 'POST',
  )
  await page
    .getByLabel('编辑器上传图片', { exact: true })
    .setInputFiles({ name: `${title}.png`, mimeType: 'image/png', buffer: image })
  const mediaResponse = await uploaded
  expect(mediaResponse.status()).toBe(201)
  const media = (await mediaResponse.json()).data
  const picker = page.getByRole('dialog', { name: '选择媒体库文件', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByLabel('搜索媒体', { exact: true }).fill(`${title}.png`)
  await picker.getByRole('button', { name: '查看媒体 ' + `${title}.png`, exact: true }).click()
  const mediaDetail = page.getByRole('dialog', { name: '媒体详情', exact: true })
  await mediaDetail.getByLabel('媒体替代文本', { exact: true }).fill('')
  await expect(mediaDetail.getByRole('button', { name: '选择此文件', exact: true })).toBeDisabled()
  await mediaDetail.getByLabel('媒体替代文本', { exact: true }).fill('文章上传图片描述')
  await mediaDetail.getByRole('button', { name: '选择此文件', exact: true }).click()
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(new RegExp(media.url))
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('保存成功')
  const id = page.url().split('/').at(-1)!
  const detail = await page.request.get(`/api/v1/admin/articles/${id}`)
  const article = (await detail.json()).data
  const staleEditor = await page.context().newPage()
  await staleEditor.goto(`/admin/articles/${id}`)
  await expect(staleEditor.getByLabel('正文', { exact: true })).toHaveValue(article.content)
  expect((await page.request.get(`/api/v1/articles/${article.slug}`)).status()).toBe(404)
  expect(
    (
      await page.request.delete(`/api/v1/admin/media/${media.id}`, {
        headers: { Origin: testBaseURL },
      })
    ).status(),
  ).toBe(409)
  const preview = await page.request.post(`/api/v1/admin/articles/${id}/preview-token`, {
    headers: { Origin: testBaseURL },
  })
  const previewUrl = (await preview.json()).data.url
  const view = await page.context().newPage()
  const previewResponse = await view.goto(previewUrl)
  expect(previewResponse?.headers()['x-robots-tag']).toContain('noindex')
  await expect(view.getByRole('heading', { name: title })).toBeVisible()
  const published = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/admin/articles/${id}`) &&
      response.request().method() === 'PATCH',
  )
  await page.getByRole('button', { name: '发布文章', exact: true }).click()
  expect((await published).status()).toBe(200)
  await staleEditor.getByLabel('正文', { exact: true }).fill('另一个窗口的旧版本本地正文')
  const rejected = staleEditor.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/admin/articles/${id}`) &&
      response.request().method() === 'PATCH',
  )
  await staleEditor.getByRole('button', { name: '保存草稿', exact: true }).click()
  expect((await rejected).status()).toBe(409)
  staleEditor.once('dialog', (dialog) => dialog.accept())
  await staleEditor.reload()
  await staleEditor.getByRole('button', { name: '恢复正文', exact: true }).click()
  await expect(staleEditor.getByLabel('正文', { exact: true })).toHaveValue(
    '另一个窗口的旧版本本地正文',
  )
  await expect(staleEditor.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
  staleEditor.once('dialog', (dialog) => dialog.accept())
  await staleEditor.reload()
  await staleEditor.getByRole('button', { name: '恢复正文', exact: true }).click()
  await expect(staleEditor.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
  const unchanged = (await (await page.request.get(`/api/v1/admin/articles/${id}`)).json()).data
  expect(unchanged.content).toBe(article.content)
  expect(unchanged.status).toBe('PUBLISHED')
  await staleEditor.close()
  await expect(page.getByRole('status')).toContainText('保存成功')
  await view.goto(`/articles/${article.slug}`)
  await expect(view.getByRole('heading', { name: title })).toBeVisible()
  await expect(view.getByText('保留扩展结构')).toBeVisible()
  expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await view.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(view.locator('html')).toHaveClass(/dark/)
  await expect(view.locator('pre.shiki')).toHaveCSS('background-color', 'rgb(36, 41, 46)')
  await view.screenshot({ path: testInfo.outputPath('article-dark.png'), fullPage: true })
  const noJsContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: page.viewportSize() ?? undefined,
  })
  const noJs = await noJsContext.newPage()
  await noJs.goto(`/articles/${article.slug}`)
  await expect(noJs.getByRole('heading', { name: title })).toBeVisible()
  await expect(noJs.getByText('保留扩展结构')).toBeVisible()
  await noJsContext.close()
  await page.goto('/admin/articles')
  await page.getByLabel('筛选文章').fill(title)
  const row = page.locator('div.rounded-xl').filter({ has: page.getByText(title, { exact: true }) })
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByText(title, { exact: true })).toHaveCount(0)
  expect((await page.request.get(`/api/v1/articles/${article.slug}`)).status()).toBe(404)
  await page.goto('/admin/articles/trash')
  await page.getByLabel('筛选文章').fill(title)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.getByText(title, { exact: true })).toHaveCount(0)
  expect((await page.request.get(`/api/v1/articles/${article.slug}`)).status()).toBe(200)
  // 仅清理本次创建的数据，仍走修订和彻底删除权限检查。
  const current = (await (await page.request.get(`/api/v1/admin/articles/${id}`)).json()).data
  await page.request.delete(`/api/v1/admin/articles/${id}`, {
    headers: { Origin: testBaseURL },
    data: { revision: current.revision },
  })
  await page.request.delete(`/api/v1/admin/articles/${id}/purge`, {
    headers: { Origin: testBaseURL },
    data: { revision: current.revision + 1 },
  })
  expect(
    (
      await page.request.delete(`/api/v1/admin/media/${media.id}`, {
        headers: { Origin: testBaseURL },
      })
    ).status(),
  ).toBe(200)
  expect((await page.request.get(media.url)).status()).toBe(404)
  await view.close()
})

test('延迟保存返回前离开仍保留请求期间新增的本地正文', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '保存竞态单视口验证')
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  const user = (await (await page.request.get('/api/v1/auth/me')).json()).data
  await page.goto('/admin/articles/new')
  await page.getByLabel('文章标题', { exact: true }).fill(`保存竞态-${Date.now()}`)
  await page.getByLabel('正文', { exact: true }).fill('初始正文')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('保存成功')
  const id = page.url().split('/').at(-1)!
  let signal!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    signal = resolve
  })
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/v1/admin/articles/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    const response = await route.fetch()
    signal()
    await hold
    await route.fulfill({ response })
  })
  await page.getByLabel('正文', { exact: true }).fill('已送出的快照')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await started
  await page.getByLabel('正文', { exact: true }).fill('保存请求期间新增的输入')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('link', { name: '← 文章列表', exact: true }).click()
  await expect(page).toHaveURL('/admin/articles')
  release()
  const key = `article-draft:${user.id}:${id}`
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), key))
    .toMatchObject({ draft: { content: '保存请求期间新增的输入' }, revision: 2 })
  await page.unroute(`**/api/v1/admin/articles/${id}`)
  await page.goto(`/admin/articles/${id}`)
  await page.getByRole('button', { name: '恢复正文', exact: true }).click()
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue('保存请求期间新增的输入')
  await page.request.delete(`/api/v1/admin/articles/${id}`, {
    headers: { Origin: testBaseURL },
    data: { revision: 2 },
  })
  await page.request.delete(`/api/v1/admin/articles/${id}/purge`, {
    headers: { Origin: testBaseURL },
    data: { revision: 3 },
  })
})
