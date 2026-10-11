import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { type Prisma, PrismaClient } from '@prisma/client'
import sharp from 'sharp'
function database() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('只允许独立测试库')
  return new PrismaClient({ datasources: { db: { url } } })
}
const headers = { Origin: testBaseURL }
test('About资料结构化编辑、独立开关、同源经历及409形成闭环', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '后台桌面闭环')
  const db = database(),
    original = await db.profile.findUniqueOrThrow({ where: { id: 'default' } }),
    about = await db.module.findUniqueOrThrow({ where: { key: 'about' } }),
    timeline = await db.module.findUniqueOrThrow({ where: { key: 'timeline' } }),
    prefix = '资料闭环-' + Date.now(),
    ids: string[] = [],
    mediaIds: string[] = []
  try {
    await db.profile.update({
      where: { id: 'default' },
      data: {
        name: prefix,
        headline: '可验证的产品开发',
        bio: '## 关于我的真实正文',
        email: 'profile-private@example.com',
        phone: '+8613900011223',
        contactVisible: true,
        advantages: [],
        skills: [],
        services: [],
        socials: [
          {
            platform: 'github',
            label: '公开代码',
            url: 'https://github.com/example',
            icon: 'github',
          },
        ],
      },
    })
    await db.module.update({
      where: { key: 'about' },
      data: {
        enabled: true,
        config: {
          sections: {
            bio: true,
            advantages: true,
            skills: true,
            experience: true,
            services: true,
            contact: true,
          },
        },
      },
    })
    await db.module.update({
      where: { key: 'timeline' },
      data: {
        enabled: true,
        config: {
          direction: 'asc',
          types: { WORK: true, EDUCATION: true, PROJECT: true, AWARD: true, MILESTONE: true },
        },
      },
    })
    const item = await db.timelineItem.create({
      data: {
        title: prefix + '-同源经历',
        type: 'WORK',
        startDate: new Date('2020-01-01'),
        startPrecision: 'YEAR',
        isCurrent: true,
        visible: false,
        showOnAbout: true,
        description: '同源经历正文',
      },
    })
    ids.push(item.id)
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/profile')
    await expect(page.getByLabel('姓名', { exact: true })).toHaveValue(prefix)
    const experiences = page.getByRole('region', { name: '只读工作经历' })
    await expect(experiences).toContainText(prefix + '-同源经历')
    await expect(experiences.getByRole('link', { name: '去管理 →' })).toHaveAttribute(
      'href',
      '/admin/timeline',
    )
    await page.getByText('个人优势（0项）', { exact: true }).click()
    await page.getByRole('button', { name: '添加优势', exact: true }).click()
    await page.getByLabel('优势标题 1', { exact: true }).fill('工程化交付')
    await page.getByLabel('优势描述 1', { exact: true }).fill('构建时间减少40%')
    await page.getByRole('button', { name: '删除优势 1', exact: true }).click()
    await page.getByRole('button', { name: '撤销上次删除', exact: true }).click()
    await expect(page.getByLabel('优势标题 1', { exact: true })).toHaveValue('工程化交付')
    await page.getByText('优势图标 1：wrench', { exact: true }).click()
    await page.getByLabel('搜索优势图标 1', { exact: true }).fill('zap')
    await page.getByRole('button', { name: '优势图标 1 zap', exact: true }).click()
    await page.getByRole('button', { name: '添加优势', exact: true }).click()
    await page.getByLabel('优势标题 2', { exact: true }).fill('跨团队协作')
    await page.getByLabel('优势描述 2', { exact: true }).fill('可复现的协作成果')
    const handle = page.getByRole('button', { name: '拖拽排序 优势 2', exact: true })
    await handle.focus()
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('status').filter({ hasText: 'moved over droppable area 优势-1' }),
    ).toBeVisible()
    await page.keyboard.press('ArrowUp')
    await expect(
      page.getByRole('status').filter({ hasText: 'droppable area 优势-0' }),
    ).toBeVisible()
    await page.keyboard.press('Space')
    await expect(page.getByLabel('优势标题 1', { exact: true })).toHaveValue('跨团队协作')
    // 上传是新编辑，必须结束删除撤销，防止旧快照回退已确认的媒体地址。
    await page.getByRole('button', { name: '删除优势 2', exact: true }).click()
    const avatarSaving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/media/upload') &&
        response.request().method() === 'POST',
    )
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#6366f1' },
    })
      .png()
      .toBuffer()
    await page
      .getByLabel('上传头像', { exact: true })
      .setInputFiles({ name: '个人头像.png', mimeType: 'image/png', buffer: png })
    const avatarResult = await avatarSaving
    expect(avatarResult.status()).toBe(201)
    const avatar = (await avatarResult.json()).data
    mediaIds.push(avatar.id)
    await expect(page.getByLabel('头像地址', { exact: true })).toHaveValue(avatar.url)
    await expect(page.getByRole('button', { name: '撤销上次删除', exact: true })).toHaveCount(0)
    const resumeSaving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/media/upload') &&
        response.request().method() === 'POST',
    )
    await page.getByLabel('上传PDF简历', { exact: true }).setInputFiles({
      name: '个人简历.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
      ),
    })
    const resumeResult = await resumeSaving
    expect(resumeResult.status()).toBe(201)
    const resume = (await resumeResult.json()).data
    mediaIds.push(resume.id)
    await expect(page.getByLabel('简历地址', { exact: true })).toHaveValue(resume.url)
    await page.getByRole('button', { name: '测试简历链接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '简历链接可访问' })).toBeVisible()
    await page.getByText('技能矩阵（0组）', { exact: true }).click()
    await page.getByRole('button', { name: '添加技能组', exact: true }).click()
    await page.getByLabel('技能组名称 1', { exact: true }).fill('前端工程')
    await page.getByRole('button', { name: '添加技能', exact: true }).click()
    await page.getByLabel('技能名称 1-1', { exact: true }).fill('React')
    await page
      .getByRole('group', { name: '技能等级 1-1' })
      .getByRole('button', { name: '等级 5星', exact: true })
      .click()
    await page.getByLabel('公开联系方式', { exact: true }).uncheck()
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/admin/profile') && response.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    expect((await saving).status()).toBe(200)
    await expect(page.getByRole('status').filter({ hasText: '资料已保存' })).toBeVisible()
    const admin = (await (await page.request.get('/api/v1/admin/profile')).json()).data
    expect(admin.contactVisible).toBe(false)
    expect(admin.advantages[0].title).toBe('跨团队协作')
    expect(admin.avatar).toBe(avatar.url)
    expect(admin.resumeUrl).toBe(resume.url)
    expect(admin.skills[0].items[0].level).toBe(5)
    await page.goto(about.route)
    await expect(page.getByRole('heading', { name: prefix, exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '工作经历' })).toContainText(prefix + '-同源经历')
    await expect(page.getByRole('link', { name: '查看完整时间轴 →' })).toHaveAttribute(
      'href',
      timeline.route,
    )
    await expect(page.getByRole('region', { name: '个人优势' })).toContainText('可复现的协作成果')
    await expect(page.getByRole('meter', { name: 'React熟练程度' })).toHaveAttribute(
      'aria-valuenow',
      '5',
    )
    for (const path of [about.route, '/', '/api/v1/profile', '/api/v1/site']) {
      const response = await page.request.get(path)
      expect(response.status()).toBe(200)
      const text = await response.text()
      for (const hidden of ['profile-private@example.com', '+8613900011223', 'mailto:', 'tel:'])
        expect(text).not.toContain(hidden)
    }
    const publicTimeline = (await (await page.request.get('/api/v1/timeline')).json()).data
    expect(publicTimeline.map((entry: { id: string }) => entry.id)).not.toContain(item.id)
    expect(
      (
        await page.request.patch('/api/v1/admin/timeline/' + item.id, {
          headers,
          data: { revision: item.revision, title: prefix + '-同步新名称' },
        })
      ).status(),
    ).toBe(200)
    await page.reload()
    await expect(page.getByRole('region', { name: '工作经历' })).toContainText(
      prefix + '-同步新名称',
    )
    expect(
      (
        await page.request.patch('/api/v1/admin/modules/timeline', {
          headers,
          data: { enabled: false },
        })
      ).status(),
    ).toBe(200)
    await page.reload()
    await expect(page.getByRole('region', { name: '工作经历' })).toHaveCount(0)
    expect((await page.request.get(timeline.route)).status()).toBe(404)
    expect(
      (
        await page.request.patch('/api/v1/admin/modules/about', {
          headers,
          data: {
            config: {
              sections: {
                bio: false,
                advantages: false,
                skills: false,
                experience: false,
                services: false,
                contact: false,
              },
            },
          },
        })
      ).status(),
    ).toBe(200)
    await page.reload()
    await expect(page.getByRole('heading', { name: prefix, exact: true })).toBeVisible()
    for (const name of ['关于我', '个人优势', '技能', '工作经历', '我能提供', '联系我'])
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0)
    await page.goto('/admin/profile')
    await expect(page.getByLabel('姓名', { exact: true })).toHaveValue(prefix)
    const current = (await (await page.request.get('/api/v1/admin/profile')).json()).data
    expect(
      (
        await page.request.patch('/api/v1/admin/profile', {
          headers,
          data: { revision: current.revision, headline: '其他窗口的新定位' },
        })
      ).status(),
    ).toBe(200)
    await page.getByLabel('一句话定位', { exact: true }).fill('不能覆盖的新草稿')
    const conflicted = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/admin/profile') && response.status() === 409,
    )
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    await conflicted
    await expect(page.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
    await expect(page.getByLabel('冲突资料副本')).toContainText('不能覆盖的新草稿')
  } finally {
    await db.profile.update({
      where: { id: 'default' },
      data: {
        ...original,
        socials: original.socials as Prisma.InputJsonValue,
        advantages: original.advantages as Prisma.InputJsonValue,
        skills: original.skills as Prisma.InputJsonValue,
        services: original.services as Prisma.InputJsonValue,
      },
    })
    for (const column of [about, timeline])
      await db.module.update({
        where: { key: column.key },
        data: { enabled: column.enabled, config: column.config as Prisma.InputJsonValue },
      })
    await db.timelineItem.deleteMany({ where: { id: { in: ids } } })
    for (const id of mediaIds)
      expect((await page.request.delete('/api/v1/admin/media/' + id, { headers })).status()).toBe(
        200,
      )
    await db.$disconnect()
  }
})

test('About三端长内容、暗色、减弱动效及无JS仍展示资料', async ({ page, browser }, info) => {
  const db = database(),
    original = await db.profile.findUniqueOrThrow({ where: { id: 'default' } }),
    about = await db.module.findUniqueOrThrow({ where: { key: 'about' } })
  try {
    await db.module.update({
      where: { key: 'about' },
      data: {
        enabled: true,
        config: {
          sections: {
            bio: true,
            advantages: true,
            skills: true,
            experience: true,
            services: true,
            contact: true,
          },
        },
      },
    })
    await db.profile.update({
      where: { id: 'default' },
      data: {
        name: '三端个人介绍',
        headline: '长内容换行与真实成果展示',
        bio: '## 职业选择\n\n' + '完整长文内容。'.repeat(100),
        contactVisible: false,
        advantages: [{ title: 'A'.repeat(200), description: '落地CI及复现过程', icon: 'wrench' }],
        skills: [
          { category: 'B'.repeat(200), items: [{ name: 'TypeScript', level: 5, years: 5 }] },
        ],
        services: [
          { title: '技术咨询', description: '工程架构与性能评审', icon: 'message-circle' },
        ],
      },
    })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.goto(about.route)
    await expect(page.getByRole('heading', { name: '三端个人介绍', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: 'docs/verification/phase-d-images/about-dark-' + info.project.name + '.png',
      fullPage: true,
    })
    const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: info.project.use.viewport,
      }),
      native = await context.newPage()
    await native.goto(testBaseURL + about.route)
    await expect(native.getByRole('heading', { name: '三端个人介绍', exact: true })).toBeVisible()
    await expect(native.getByRole('region', { name: '我能提供' })).toContainText('技术咨询')
    await context.close()
  } finally {
    await db.profile.update({
      where: { id: 'default' },
      data: {
        ...original,
        socials: original.socials as Prisma.InputJsonValue,
        advantages: original.advantages as Prisma.InputJsonValue,
        skills: original.skills as Prisma.InputJsonValue,
        services: original.services as Prisma.InputJsonValue,
      },
    })
    await db.module.update({
      where: { key: 'about' },
      data: { enabled: about.enabled, config: about.config as Prisma.InputJsonValue },
    })
    await db.$disconnect()
  }
})

test('资料未保存立即站内离开时保留本地稿并可恢复', async ({ page }, info) => {
  test.skip(info.project.name !== '1440', '后台离开保护')
  const db = database()
  try {
    await db.rateLimit.deleteMany({
      where: { key: { in: ['login:ip:unknown', 'login:email:admin@example.com'] } },
    })
    await page.goto('/login')
    await page.getByLabel('邮箱', { exact: true }).fill('admin@example.com')
    await page.getByLabel('密码', { exact: true }).fill('ChangeMe123')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/profile')
    await expect(page.getByLabel('姓名', { exact: true })).toBeEnabled()
    const value = '快速离开本地稿-' + Date.now()
    await page.getByLabel('一句话定位', { exact: true }).fill(value)
    await page.getByText(/^个人优势（/).click()
    await page.getByRole('button', { name: '添加优势', exact: true }).click()
    await page
      .getByLabel(/^优势描述 \d+$/)
      .last()
      .fill('标题未完成也必须恢复')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('link', { name: '仪表盘', exact: true }).click()
    await expect(page).toHaveURL('/admin')
    await page.goto('/admin/profile')
    await expect(page.getByRole('button', { name: '恢复本地稿', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '恢复本地稿', exact: true }).click()
    await expect(page.getByLabel('一句话定位', { exact: true })).toHaveValue(value)
    await page.getByText(/^个人优势（/).click()
    await expect(page.getByLabel(/^优势描述 \d+$/).last()).toHaveValue('标题未完成也必须恢复')
    await expect(page.getByLabel(/^优势标题 \d+$/).last()).toHaveValue('')
    await page
      .getByRole('button', { name: /^删除优势 \d+$/ })
      .last()
      .click()
    await expect(page.getByRole('button', { name: '撤销上次删除', exact: true })).toBeVisible()
    await page.getByLabel('一句话定位', { exact: true }).fill(value + '-后续编辑')
    await expect(page.getByRole('button', { name: '撤销上次删除', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('一句话定位', { exact: true })).toHaveValue(value + '-后续编辑')
  } finally {
    await page
      .evaluate(() => {
        for (const key of Object.keys(localStorage))
          if (key.startsWith('profile-draft:')) localStorage.removeItem(key)
      })
      .catch(() => {})
    await db.$disconnect()
  }
})
