import { testBaseURL } from './base-url'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from '@playwright/test'
import type { DataBundle } from '../../src/lib/data-file'
const headers = { Origin: testBaseURL }
function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('只允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
async function login(page: Page, db: PrismaClient) {
  const actual = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
  if (!actual[0]?.name.endsWith('_test')) throw new Error('实际数据库不是独立测试库')
  await db.rateLimit.deleteMany({
    where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
  })
  await page.goto('/login')
  await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
  await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL('/admin')
  await page.goto('/admin/data')
  await expect(page.getByRole('button', { name: '下载全站JSON', exact: true })).toBeEnabled()
}
async function choose(page: Page, bundle: DataBundle) {
  await page.getByLabel('选择JSON导出文件', { exact: true }).setInputFiles({
    name: 'restore.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  })
  await expect(page.getByRole('status').filter({ hasText: '文件已读取' })).toBeVisible()
}
async function preview(page: Page) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/admin/import/preview') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '校验并预览影响', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(200)
  await expect(page.getByRole('region', { name: '导入影响预览', exact: true })).toBeVisible()
  return (await response.json()).data
}
test('真实JSON下载、合并恢复关系、替换预览冲突及恢复旧稿保护', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '完整恢复事务在独立测试库桌面验收')
  test.setTimeout(120000)
  const db = database()
  let backup: DataBundle | null = null
  const backupPath = join(process.cwd(), '.test-backups', 'data-browser-test-backup.json')
  try {
    if (existsSync(backupPath)) throw new Error('存在未恢复的浏览器测试备份，请先恢复独立测试库。')
    await login(page, db)
    const baseline = await page.request.get('/api/v1/admin/export')
    expect(baseline.status()).toBe(200)
    backup = (await baseline.json()).data
    // 原包落在Git忽略目录；异常中断时保留，恢复成功后才删除。
    await mkdir(join(process.cwd(), '.test-backups'), { recursive: true })
    await writeFile(backupPath, JSON.stringify(backup), { encoding: 'utf8', flag: 'wx' })
    const prefix = 'data-browser-' + Date.now()
    const root = await db.category.create({ data: { name: '恢复根分类', slug: prefix + '-root' } })
    const child = await db.category.create({
      data: { name: '恢复子分类', slug: prefix + '-child', parentId: root.id },
    })
    const tag = await db.tag.create({ data: { name: '跨模块恢复', slug: prefix + '-tag' } })
    const article = await db.article.create({
      data: {
        title: '待恢复文章',
        slug: prefix + '-article',
        content: '  # 保留原文\n\n未知结构 :::keep\n',
        status: 'DRAFT',
        categoryId: child.id,
        tags: { connect: { id: tag.id } },
      },
    })
    const log = await db.log.create({
      data: {
        title: '待恢复未来日志',
        type: 'DAILY',
        content: '未来正文',
        logDate: new Date('2025-02-01'),
        status: 'PUBLISHED',
        publishedAt: new Date('2099-01-01'),
        tags: { connect: { id: tag.id } },
      },
    })
    const project = await db.project.create({
      data: {
        title: '待恢复作品',
        slug: prefix + '-project',
        type: 'REPO',
        description: '作品正文',
        status: 'ARCHIVED',
        deletedAt: new Date(),
        tags: { connect: { id: tag.id } },
      },
    })
    const timeline = await db.timelineItem.create({
      data: {
        title: '待恢复月份经历',
        type: 'WORK',
        startDate: new Date('2025-02-01'),
        startPrecision: 'MONTH',
        visible: false,
        showOnAbout: false,
      },
    })
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载全站JSON', exact: true }).click()
    const downloaded = await downloading
    const downloadedPath = await downloaded.path()
    expect(downloadedPath).not.toBeNull()
    const bundle = JSON.parse(await readFile(downloadedPath!, 'utf8')) as DataBundle
    expect(bundle.version).toBe('1.0')
    for (const key of ['users', 'sessions', 'previewTokens', 'uploadIntents', 'auditLogs', 'media'])
      expect(Object.hasOwn(bundle.data, key)).toBe(false)
    expect(JSON.stringify(bundle.data.articles)).toContain(article.content.replace(/\n/g, '\\n'))
    await db.article.delete({ where: { id: article.id } })
    await db.log.delete({ where: { id: log.id } })
    await db.project.delete({ where: { id: project.id } })
    await db.timelineItem.delete({ where: { id: timeline.id } })
    await db.category.deleteMany({ where: { id: { in: [child.id, root.id] } } })
    await db.tag.delete({ where: { id: tag.id } })
    await choose(page, bundle)
    const calculated = await preview(page)
    expect(calculated.created.articles).toBe(1)
    expect(calculated.created.categories).toBe(2)
    const previewDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载影响报告', exact: true }).click()
    const previewPath = await (await previewDownload).path()
    expect(Object.hasOwn(JSON.parse(await readFile(previewPath!, 'utf8')), 'token')).toBe(false)
    await page.getByRole('button', { name: '校验并预览影响', exact: true }).focus()
    const executeButton = page.getByRole('button', { name: '执行导入', exact: true })
    // 映射折叠项也进入Tab顺序，不能假设报告按钮紧邻预览按钮。
    for (
      let step = 0;
      step < 30 && !(await executeButton.evaluate((node) => node === document.activeElement));
      step++
    )
      await page.keyboard.press('Tab')
    await expect(executeButton).toBeFocused()
    const executed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/import') && response.request().method() === 'POST',
    )
    await page.keyboard.press('Enter')
    expect((await executed).status()).toBe(200)
    await expect(page.getByRole('region', { name: '导入实际结果', exact: true })).toBeVisible()
    const restored = await db.article.findUniqueOrThrow({
      where: { id: article.id },
      include: { tags: true },
    })
    expect(restored.content).toBe(article.content)
    expect(restored.categoryId).toBe(child.id)
    expect(restored.tags.map((item) => item.id)).toEqual([tag.id])
    expect(restored.deletedAt).toBeNull()
    const restoredLog = await db.log.findUniqueOrThrow({
      where: { id: log.id },
      include: { tags: true },
    })
    expect(restoredLog.status).toBe('PUBLISHED')
    expect(restoredLog.publishedAt).toEqual(log.publishedAt)
    expect(restoredLog.tags.map((item) => item.id)).toEqual([tag.id])
    const restoredProject = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { tags: true },
    })
    expect(restoredProject.status).toBe('ARCHIVED')
    expect(restoredProject.deletedAt).not.toBeNull()
    expect(restoredProject.tags.map((item) => item.id)).toEqual([tag.id])
    const restoredTimeline = await db.timelineItem.findUniqueOrThrow({ where: { id: timeline.id } })
    expect(restoredTimeline.visible).toBe(false)
    expect(restoredTimeline.showOnAbout).toBe(false)
    expect((await db.category.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(
      root.id,
    )
    expect(
      (await db.timelineItem.findUniqueOrThrow({ where: { id: timeline.id } })).startPrecision,
    ).toBe('MONTH')
    expect((await page.request.get('/api/v1/articles/' + article.slug)).status()).toBe(404)
    expect((await page.request.get('/api/v1/logs/' + log.id)).status()).toBe(404)
    expect((await page.request.get('/api/v1/projects/' + project.slug)).status()).toBe(404)
    expect(JSON.stringify(await (await page.request.get('/api/v1/timeline')).json())).not.toContain(
      timeline.id,
    )
    await page.getByLabel('导入模式', { exact: true }).selectOption('replace')
    await preview(page)
    await expect(page.getByRole('button', { name: '执行导入', exact: true })).toBeDisabled()
    const modified = await db.article.update({
      where: { id: article.id },
      data: { content: '预览后有新修改', revision: { increment: 1 } },
    })
    await page.getByLabel('替换确认文字', { exact: true }).fill('替换全部内容')
    const stale = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/admin/import') && response.status() === 409,
    )
    await page.getByRole('button', { name: '执行导入', exact: true }).click()
    await stale
    await expect(page.getByRole('alert').filter({ hasText: '重新预览' })).toBeVisible()
    await expect(page.getByRole('region', { name: '待导入文件', exact: true })).toBeVisible()
    expect((await db.article.findUniqueOrThrow({ where: { id: article.id } })).content).toBe(
      '预览后有新修改',
    )
    await preview(page)
    await page.getByLabel('替换确认文字', { exact: true }).fill('替换全部内容')
    const replacement = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/import') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '执行导入', exact: true }).click()
    expect((await replacement).status()).toBe(200)
    const replaced = await db.article.findUniqueOrThrow({ where: { id: article.id } })
    expect(replaced.content).toBe(article.content)
    expect(replaced.revision).toBeGreaterThan(modified.revision)
    expect(
      (
        await page.request.patch('/api/v1/admin/articles/' + article.id, {
          headers,
          data: { revision: modified.revision, title: '旧稿禁止覆盖恢复' },
        })
      ).status(),
    ).toBe(409)
    const reportDownloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载影响报告', exact: true }).click()
    const reportPath = await (await reportDownloading).path()
    expect(Object.hasOwn(JSON.parse(await readFile(reportPath!, 'utf8')), 'token')).toBe(false)
  } finally {
    try {
      if (backup) {
        // 测试结束通过真实导入事务恢复独立测试库的原始内容，不能操作开发库。
        const checked = await page.request.post('/api/v1/admin/import/preview', {
          headers,
          data: { mode: 'replace', bundle: backup },
        })
        expect(checked.status()).toBe(200)
        const token = (await checked.json()).data.token
        expect(
          (
            await page.request.post('/api/v1/admin/import', {
              headers,
              data: { mode: 'replace', bundle: backup, token, confirmation: '替换全部内容' },
            })
          ).status(),
        ).toBe(200)
        await unlink(backupPath)
      }
    } finally {
      await db.$disconnect()
    }
  }
})

test('数据管理三端文件校验、模式变化作废预览及键盘确认可用', async ({ page }, info) => {
  const db = database()
  try {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await login(page, db)
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page
      .getByLabel('选择JSON导出文件', { exact: true })
      .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') })
    await expect(page.getByRole('alert').filter({ hasText: 'JSON' })).toBeVisible()
    await expect(page.getByRole('button', { name: '校验并预览影响', exact: true })).toBeDisabled()
    const bundle = (await (await page.request.get('/api/v1/admin/export')).json())
      .data as DataBundle
    await choose(page, bundle)
    await preview(page)
    await choose(page, bundle)
    await expect(page.getByRole('region', { name: '导入影响预览', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '执行导入', exact: true })).toHaveCount(0)
    await preview(page)
    await page.getByLabel('导入模式', { exact: true }).selectOption('replace')
    await expect(page.getByRole('region', { name: '导入影响预览', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '执行导入', exact: true })).toHaveCount(0)
    await preview(page)
    await page.getByLabel('替换确认文字', { exact: true }).focus()
    await page.keyboard.type('错误文字')
    await expect(page.getByRole('button', { name: '执行导入', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/data-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    // 本场景只预览，不执行替换。
  } finally {
    await db.$disconnect()
  }
})
