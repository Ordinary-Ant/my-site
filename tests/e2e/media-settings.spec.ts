import { PrismaClient, Prisma } from '@prisma/client'
import { expect, test, type Page, type Request, type Dialog } from '@playwright/test'
import sharp from 'sharp'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('仅允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
async function login(page: Page, db: PrismaClient) {
  const name = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
  if (!name[0]?.name.endsWith('_test')) throw new Error('实际数据库不安全')
  const actor = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } })
  await db.rateLimit.deleteMany({
    where: {
      key: {
        in: [
          'login:ip:unknown',
          'login:email:admin@example.com',
          'adminwrite:' + actor.id,
          'upload:' + actor.id,
        ],
      },
    },
  })
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill(actor.email)
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  return actor
}
async function confirm(page: Page, action: () => Promise<unknown>) {
  page.once('dialog', (dialog) => dialog.accept())
  await action()
}
async function png(value: number) {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: {
        r: value % 255,
        g: Math.floor(value / 255) % 255,
        b: Math.floor(value / 65025) % 255,
        alpha: 1,
      },
    },
  })
    .png()
    .toBuffer()
}

test('媒体真实上传、秒传重试、批量引用保护、设置及正文选择器闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '完整媒体生命周期仅桌面执行，三端布局另测')
  test.setTimeout(120000)
  const db = database(),
    run = 'media-browser-' + Date.now(),
    folder = '/' + run
  const originals = await db.setting.findMany({
    where: { key: { in: ['media.folders', 'site.logo'] } },
  })
  const names = [
    run + '-good.png',
    run + '-bad.png',
    run + '-retry.png',
    run + '-drop.png',
    run + '-paste.png',
  ]
  let articleId: string | null = null
  try {
    const actor = await login(page, db)
    await page.goto('/admin/media')
    await page.getByLabel('新目录路径', { exact: true }).fill(folder + '/')
    await page.getByRole('button', { name: '新建目录', exact: true }).click()
    await expect(page.getByLabel('媒体目录', { exact: true })).toHaveValue(folder)
    await page.reload()
    await expect(page.getByLabel('媒体目录', { exact: true })).toHaveValue(folder)
    const first = await png(Date.now())
    await page.getByLabel('上传文件', { exact: true }).setInputFiles([
      { name: names[0], mimeType: 'image/png', buffer: first },
      { name: names[1], mimeType: 'image/png', buffer: Buffer.from('pretend png') },
    ])
    await expect(page.getByText('上传并验证成功。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '重试 ' + names[1], exact: true })).toBeVisible()
    const good = await db.media.findFirstOrThrow({ where: { originalName: names[0] } })
    expect((await page.request.get(good.url)).status()).toBe(200)
    await page
      .getByLabel('上传文件', { exact: true })
      .setInputFiles({ name: run + '-same.png', mimeType: 'image/png', buffer: first })
    await expect(
      page.getByText('已复用' + folder + '中的文件，保留原描述。', { exact: true }),
    ).toBeVisible()
    expect(await db.media.count({ where: { hash: good.hash } })).toBe(1)
    let failOnce = true
    await page.route('**/api/v1/admin/media/upload', async (route) => {
      if (failOnce && route.request().postDataBuffer()?.includes(Buffer.from(names[2]))) {
        failOnce = false
        return route.abort('failed')
      }
      await route.continue()
    })
    await page
      .getByLabel('上传文件', { exact: true })
      .setInputFiles({ name: names[2], mimeType: 'image/png', buffer: await png(Date.now() + 1) })
    await page.getByRole('button', { name: '重试 ' + names[2], exact: true }).click()
    await expect(
      page.getByRole('button', { name: '查看媒体 ' + names[2], exact: true }),
    ).toBeVisible()
    await page.unrouteAll({ behavior: 'wait' })
    for (const [index, event] of [
      [3, 'drop'],
      [4, 'paste'],
    ] as const) {
      const bytes = Array.from(await png(Date.now() + index + 100))
      await page.evaluate(
        ({ bytes, name, event }) => {
          const data = new DataTransfer()
          data.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
          if (event === 'drop')
            document
              .querySelector('[aria-label="上传队列"]')!
              .dispatchEvent(
                new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
              )
          else
            document.dispatchEvent(
              new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
            )
        },
        { bytes, name: names[index], event },
      )
      await expect(
        page.getByRole('button', { name: '查看媒体 ' + names[index], exact: true }),
      ).toBeVisible()
    }
    const retry = await db.media.findFirstOrThrow({ where: { originalName: names[2] } })
    for (const name of [names[0], names[2]])
      await page.getByLabel('选择媒体 ' + name, { exact: true }).check()
    await page.getByLabel('媒体批量操作', { exact: true }).selectOption('alt')
    const description = '独特替代描述-' + run
    await page.getByLabel('批量替代文本', { exact: true }).fill(description)
    await confirm(page, () =>
      page.getByRole('button', { name: '执行批量操作', exact: true }).click(),
    )
    await expect(
      page.getByRole('status').filter({ hasText: '批量完成：成功2，失败0' }),
    ).toBeVisible()
    await page.getByLabel('搜索媒体', { exact: true }).fill(description)
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(description)
    await expect(page.getByRole('button', { name: /^查看媒体 / })).toHaveCount(2)
    for (const name of [names[0], names[2]])
      await page.getByLabel('选择媒体 ' + name, { exact: true }).check()
    await page.getByLabel('媒体批量操作', { exact: true }).selectOption('move')
    await page.getByLabel('批量目标目录', { exact: true }).fill('/' + run + '-moved')
    await confirm(page, () =>
      page.getByRole('button', { name: '执行批量操作', exact: true }).click(),
    )
    await expect(
      page.getByRole('status').filter({ hasText: '批量完成：成功2，失败0' }),
    ).toBeVisible()
    await expect(page.getByText('暂无匹配媒体。', { exact: true })).toBeVisible()
    await page.getByLabel('媒体目录', { exact: true }).selectOption('')
    await expect(page.getByRole('button', { name: /^查看媒体 / })).toHaveCount(2)
    articleId = (
      await db.article.create({
        data: {
          title: run + '-protected',
          slug: run + '-protected',
          content: '引用保护',
          coverImage: good.url,
          authorId: actor.id,
          status: 'DRAFT',
          deletedAt: new Date(),
        },
      })
    ).id
    for (const name of [names[0], names[2]])
      await page.getByLabel('选择媒体 ' + name, { exact: true }).check()
    await page.getByLabel('媒体批量操作', { exact: true }).selectOption('delete')
    await confirm(page, () =>
      page.getByRole('button', { name: '执行批量操作', exact: true }).click(),
    )
    await expect(
      page.getByRole('status').filter({ hasText: '批量完成：成功1，失败1' }),
    ).toBeVisible()
    await expect(page.getByLabel('批量操作结果')).toContainText(run + '-protected')
    expect(await db.media.findUnique({ where: { id: retry.id } })).toBeNull()
    expect(await db.media.findUnique({ where: { id: good.id } })).not.toBeNull()
    await page.getByRole('button', { name: '查看媒体 ' + names[0], exact: true }).click()
    const detail = page.getByRole('dialog', { name: '媒体详情', exact: true })
    await expect(detail.getByLabel('媒体引用来源')).toContainText(run + '-protected')
    await expect(detail.getByRole('button', { name: '删除媒体', exact: true })).toBeDisabled()
    await detail.getByLabel('媒体替代文本', { exact: true }).fill('尚未保存的媒体描述')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.keyboard.press('Escape')
    await expect(detail).toBeVisible()
    await expect(detail.getByLabel('媒体替代文本', { exact: true })).toHaveValue(
      '尚未保存的媒体描述',
    )
    await confirm(page, () => page.keyboard.press('Escape'))
    await expect(detail).toBeHidden()
    await db.article.delete({ where: { id: articleId } })
    articleId = null
    await confirm(page, () =>
      page.getByRole('button', { name: '执行批量操作', exact: true }).click(),
    )
    await expect(
      page.getByRole('status').filter({ hasText: '批量完成：成功1，失败0' }),
    ).toBeVisible()
    expect((await page.request.get(good.url)).status()).toBe(404)
    await confirm(page, () =>
      page.getByRole('button', { name: '清理临时文件与失败队列', exact: true }).click(),
    )
    await expect(page.getByRole('status').filter({ hasText: '清理完成：成功' })).toBeVisible()
    await page.goto('/admin/settings/general')
    await expect(
      page.getByText('可从媒体库选择图片；留空清除自定义Logo。', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '从媒体库选择Logo地址', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择媒体库文件', exact: true })
    await picker.getByLabel('搜索媒体', { exact: true }).fill(names[3])
    await picker.getByRole('button', { name: '查看媒体 ' + names[3], exact: true }).click()
    await page
      .getByRole('dialog', { name: '媒体详情', exact: true })
      .getByRole('button', { name: '选择此文件', exact: true })
      .click()
    await expect(picker).toBeHidden()
    const logo = await page.getByLabel('Logo地址', { exact: true }).inputValue()
    expect(logo).toContain('/api/v1/media/')
    await expect(page.getByRole('img', { name: 'Logo地址预览', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible()
    expect((await (await page.request.get('/api/v1/site')).json()).data.site.logo).toBe(logo)
    await page.getByLabel('Logo地址', { exact: true }).fill('')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect
      .poll(async () => (await db.setting.findUniqueOrThrow({ where: { key: 'site.logo' } })).value)
      .toBe(null)
    await page.goto('/admin/articles/new')
    await page.getByLabel('文章标题', { exact: true }).fill(run + '-picker')
    await page.getByRole('button', { name: '从媒体库插入图片', exact: true }).click()
    const insertPicker = page.getByRole('dialog', { name: '选择媒体库文件', exact: true })
    const reused = await db.media.findFirstOrThrow({ where: { originalName: names[4] } })
    const copiedBytes = Array.from(await (await page.request.get(reused.url)).body())
    let duplicateQueries = 0
    const countQuery = (request: Request) => {
      if (request.url().endsWith('/api/v1/admin/media/deduplicate')) duplicateQueries++
    }
    page.on('request', countQuery)
    await insertPicker.getByLabel('搜索媒体', { exact: true }).evaluate((element, bytes) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], 'picker-paste.png', { type: 'image/png' }))
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    }, copiedBytes)
    await expect(
      insertPicker.getByText('已复用' + folder + '中的文件，保留原描述。', { exact: true }),
    ).toBeVisible()
    expect(duplicateQueries).toBe(1)
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue('')
    page.off('request', countQuery)
    await page
      .getByRole('dialog', { name: '选择媒体库文件', exact: true })
      .getByLabel('搜索媒体', { exact: true })
      .fill(names[4])
    await page.getByRole('button', { name: '查看媒体 ' + names[4], exact: true }).click()
    await page
      .getByRole('dialog', { name: '媒体详情', exact: true })
      .getByLabel('媒体替代文本', { exact: true })
      .fill('正文图片描述')
    await page
      .getByRole('dialog', { name: '媒体详情', exact: true })
      .getByRole('button', { name: '选择此文件', exact: true })
      .click()
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/!\[正文图片描述\]/)
    await page.getByRole('button', { name: '所见即所得', exact: true }).click()
    const beforeImages = await page.locator('.tiptap img').count()
    let prompts = 0
    const prompt = (dialog: Dialog) =>
      prompts++ === 0 ? dialog.accept(reused.url) : dialog.dismiss()
    page.on('dialog', prompt)
    await page.getByRole('button', { name: '图片', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '图片描述不能为空' })).toBeVisible()
    expect(await page.locator('.tiptap img').count()).toBe(beforeImages)
    page.off('dialog', prompt)
  } finally {
    await page.unrouteAll({ behavior: 'wait' })
    await page.close()
    if (articleId) await db.article.deleteMany({ where: { id: articleId } })
    await db.article.deleteMany({ where: { slug: { startsWith: run } } })
    await db.setting.deleteMany({ where: { key: { in: ['media.folders', 'site.logo'] } } })
    for (const row of originals)
      await db.setting.create({
        data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value },
      })
    const files = await db.media.findMany({ where: { originalName: { startsWith: run } } })
    for (const file of files) {
      await db.media.delete({ where: { id: file.id } })
      await unlink(resolve('.storage', file.key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await db.auditLog.deleteMany({
      where: { OR: [{ resourceId: { in: files.map((file) => file.id) } }, { resourceId: folder }] },
    })
    await db.$disconnect()
  }
})

test('日志中的媒体目录操作不提交宿主正文', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '宿主表单隔离仅桌面验证')
  const db = database(),
    run = 'media-host-' + Date.now()
  const original = await db.setting.findUnique({ where: { key: 'media.folders' } })
  try {
    await login(page, db)
    await page.goto('/admin/logs/new')
    await page.getByLabel('标题', { exact: true }).fill(run)
    await page.getByLabel('正文', { exact: true }).fill('尚未确认保存的正文')
    await page.getByRole('button', { name: '从媒体库插入图片', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择媒体库文件', exact: true })
    let saves = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/admin/logs')) saves++
    })
    await picker.getByLabel('新目录路径', { exact: true }).fill('/' + run)
    await picker.getByRole('button', { name: '新建目录', exact: true }).click()
    await expect(picker.getByText('目录已创建。', { exact: true })).toBeVisible()
    expect(saves).toBe(0)
    await expect(page).toHaveURL('/admin/logs/new')
    expect(
      await picker.locator('form').evaluate((form) => !!form.parentElement?.closest('form')),
    ).toBe(false)
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue('尚未确认保存的正文')
  } finally {
    await page.close()
    await db.log.deleteMany({ where: { title: run } })
    await db.setting.deleteMany({ where: { key: 'media.folders' } })
    if (original)
      await db.setting.create({
        data: { ...original, value: original.value === null ? Prisma.JsonNull : original.value },
      })
    await db.$disconnect()
  }
})

test('媒体库三端暗色筛选及设置帮助、键盘取消和无溢出', async ({ page }, info) => {
  const db = database()
  try {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await login(page, db)
    await page.goto('/admin/media?q=不会存在的媒体名称&folder=%2F&kind=IMAGE')
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByLabel('媒体目录', { exact: true })).toHaveValue('/')
    await expect(page.getByText('暂无匹配媒体。', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('搜索媒体', { exact: true })).toHaveValue('不会存在的媒体名称')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/media-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    await page.goto('/admin/settings/general')
    await page.getByRole('button', { name: '从媒体库选择Logo地址', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '选择媒体库文件', exact: true })).toBeHidden()
    await page.getByLabel('站点描述', { exact: true }).fill('尚未保存设置')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('link', { name: '外观', exact: true })
      .click()
    await expect(page).toHaveURL('/admin/settings/general')
    await page.getByRole('button', { name: '取消修改', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/settings-dark-' + info.project.name + '.png',
      fullPage: true,
    })
  } finally {
    await db.$disconnect()
  }
})
