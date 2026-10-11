import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { PrismaClient, Prisma } from '@prisma/client'
import { DEFAULT_MOTION, MOTION_PRESETS } from '../../src/config/motion'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { contrast } from '../../src/lib/brand-colors'

function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('仅允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
function engineFiles() {
  const budget = JSON.parse(readFileSync('docs/verification/motion-budget.json', 'utf8'))
  expect(budget.passed).toBe(true)
  return budget.files
    .filter((file: { role: string }) => file.role === 'engine')
    .map((file: { file: string }) => file.file) as string[]
}
test('四预设预览不落库，保存刷新一致，取消与恢复默认可用', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '业务仅桌面，运行时三端另验')
  const db = database(),
    original = await db.setting.findUnique({ where: { key: 'motion.config' } })
  try {
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/settings/motion')
    await expect(page.getByRole('heading', { name: '动效设置', exact: true })).toBeVisible()
    await expect(page.getByLabel('编排预设')).toBeEnabled()
    expect(
      requested.filter((url) => engineFiles().some((file) => url.endsWith(file))),
    ).toHaveLength(0)
    const baseline = (await db.setting.findUnique({ where: { key: 'motion.config' } }))?.value
    await page.getByLabel('编排预设').selectOption('kinetic')
    await page.getByRole('button', { name: '打开动效预览' }).click()
    await expect(page.locator('[aria-label="动效预览"] .site-motion')).toHaveAttribute(
      'data-preset',
      'kinetic',
    )
    expect((await db.setting.findUnique({ where: { key: 'motion.config' } }))?.value).toEqual(
      baseline,
    )
    await page.getByRole('button', { name: '取消修改' }).click()
    await expect(page.getByLabel('编排预设')).toHaveValue(
      (baseline as typeof DEFAULT_MOTION).preset,
    )
    for (const preset of ['static', 'editorial', 'narrative', 'kinetic']) {
      await page.getByLabel('编排预设').selectOption(preset)
      await page.getByRole('button', { name: '保存动效', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('已保存')
      const response = await page.request.get('/api/v1/site')
      expect((await response.json()).data.motion.preset).toBe(preset)
      await page.reload()
      await expect(page.getByLabel('编排预设')).toHaveValue(preset)
    }
    await page.getByLabel('静态装饰').selectOption('tint')
    await page.getByLabel('底色透明度').fill('0.12')
    await page.getByRole('button', { name: '保存动效', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('已保存')
    await page.getByRole('button', { name: '恢复默认', exact: true }).click()
    await expect(page.getByLabel('编排预设')).toHaveValue('editorial')
    await page.getByRole('button', { name: '保存动效', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('已保存')
  } finally {
    await page.close()
    if (original)
      await db.setting.upsert({
        where: { key: original.key },
        create: {
          key: original.key,
          group: original.group,
          value: original.value ?? Prisma.JsonNull,
        },
        update: { value: original.value ?? Prisma.JsonNull },
      })
    else await db.setting.deleteMany({ where: { key: 'motion.config' } })
    await db.$disconnect()
  }
})

test('动效三端按需下载、减弱变化、关闭与失败不隐藏内容', async ({ page, browser }, info) => {
  const db = database(),
    original = await db.setting.findUnique({ where: { key: 'motion.config' } })
  const originalAccent = await db.setting.findUnique({ where: { key: 'theme.accent' } })
  const engines = engineFiles(),
    requests: string[] = []
  try {
    await db.setting.upsert({
      where: { key: 'motion.config' },
      create: { key: 'motion.config', group: 'motion', value: MOTION_PRESETS.static },
      update: { value: MOTION_PRESETS.static },
    })
    page.on('request', (request) => requests.push(request.url()))
    await page.goto('/')
    await expect(page.locator('.site-motion')).toHaveAttribute('data-motion', 'off')
    await page.locator('footer').scrollIntoViewIfNeeded()
    expect(requests.filter((url) => engines.some((file) => url.endsWith(file)))).toHaveLength(0)
    await db.setting.update({ where: { key: 'motion.config' }, data: { value: DEFAULT_MOTION } })
    await page.goto('/')
    await expect(page.locator('.site-motion')).toHaveAttribute(
      'data-motion',
      info.project.name === '390' ? 'subtle' : /subtle|standard/,
    )
    const engineRequest = page.waitForRequest((request) =>
      engines.some((file) => request.url().endsWith(file)),
    )
    await page.locator('footer').scrollIntoViewIfNeeded()
    await engineRequest
    await expect(page.locator('.site-motion')).toHaveAttribute('data-motion-engine', 'active')
    for (const file of engines) expect(requests.some((url) => url.endsWith(file))).toBe(true)
    mkdirSync('docs/verification/phase-f-images', { recursive: true })
    writeFileSync(
      `docs/verification/phase-f-images/network-${info.project.name}.json`,
      JSON.stringify(
        {
          staticEngineDownloads: 0,
          editorialAfterScroll: engines,
        },
        null,
        2,
      ) + '\n',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.site-motion')).toHaveAttribute('data-motion', 'off')
    await expect(page.locator('.site-motion')).not.toHaveAttribute('data-motion-engine', 'active')
    await page.getByLabel('动态效果偏好').click()
    await page.keyboard.press('Escape')
    await page.getByLabel('动态效果偏好').selectOption('full')
    await expect(page.locator('.site-motion')).toHaveAttribute('data-motion', 'off')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByLabel('动态效果偏好').selectOption('off')
    await page.reload()
    await expect(page.locator('.site-motion')).toHaveAttribute('data-motion', 'off')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await db.setting.upsert({
      where: { key: 'theme.accent' },
      create: { key: 'theme.accent', group: 'theme', value: '#ff0000' },
      update: { value: '#ff0000' },
    })
    await db.setting.update({
      where: { key: 'motion.config' },
      data: { value: { ...DEFAULT_MOTION, decoration: { type: 'tint', opacity: 0.15 } } },
    })
    await page.reload()
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      const colors = await page.locator('.site-motion').evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        fg: getComputedStyle(el.querySelector('.text-brand')!).color,
      }))
      const hex = (color: string) =>
        '#' +
        color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((v) =>
            Math.round(Number(v) * (color.startsWith('color(') ? 255 : 1))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      expect(contrast(hex(colors.fg), hex(colors.bg))).toBeGreaterThanOrEqual(4.5)
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForFunction(() => scrollY === 0)
    const brandRgb = await page
      .locator('.text-brand')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    const color =
      '#' +
      brandRgb
        .match(/\d+/g)!
        .slice(0, 3)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('')
    expect(contrast(color, '#1e1b4b')).toBeGreaterThanOrEqual(4.5)
    mkdirSync('docs/verification/phase-f-images', { recursive: true })
    await page.screenshot({
      path: `docs/verification/phase-f-images/home-dark-${info.project.name}.png`,
      fullPage: true,
    })
    const plain = await browser.newContext({
      baseURL: testBaseURL,
      javaScriptEnabled: false,
      viewport: page.viewportSize()!,
    })
    try {
      const p = await plain.newPage()
      await p.goto('/')
      await expect(p.locator('main h1')).toBeVisible()
      await expect(p.locator('footer')).toBeVisible()
    } finally {
      await plain.close()
    }
    const failed = await browser.newContext({
      baseURL: testBaseURL,
      viewport: page.viewportSize()!,
    })
    try {
      const p = await failed.newPage()
      for (const file of engines) await p.route('**/' + file, (route) => route.abort())
      await p.goto('/')
      await p.locator('footer').scrollIntoViewIfNeeded()
      await expect(p.locator('main h1')).toBeVisible()
      expect(await p.locator('main').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    } finally {
      await failed.close()
    }
  } finally {
    await page.close()
    if (original)
      await db.setting.update({
        where: { key: original.key },
        data: { value: original.value ?? Prisma.JsonNull },
      })
    else await db.setting.deleteMany({ where: { key: 'motion.config' } })
    if (originalAccent)
      await db.setting.upsert({
        where: { key: originalAccent.key },
        create: {
          key: originalAccent.key,
          group: originalAccent.group,
          value: originalAccent.value ?? Prisma.JsonNull,
        },
        update: { value: originalAccent.value ?? Prisma.JsonNull },
      })
    else await db.setting.deleteMany({ where: { key: 'theme.accent' } })
    await db.$disconnect()
  }
})
