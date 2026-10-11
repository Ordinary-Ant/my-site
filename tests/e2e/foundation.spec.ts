import { expect, test } from '@playwright/test'

test('首页三端可读且没有横向溢出', async ({ page }) => {
  await page.goto('/')
  if (page.viewportSize()!.width < 768) {
    const bottom = await page
      .getByRole('navigation', { name: '移动底部导航' })
      .evaluate((el) => el.getBoundingClientRect().bottom)
    expect(Math.abs(bottom - page.viewportSize()!.height)).toBeLessThanOrEqual(1)
    // 桌面Chromium没有手机安全区，注入34px实际底栏高度验证末尾控件不被覆盖。
    await page.addStyleTag({
      content: ':root { --site-safe-bottom: 34px } .pb-safe { padding-bottom: 34px !important }',
    })
    await page.evaluate(() =>
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
    )
    const preference = await page.getByLabel('动态效果偏好').boundingBox()
    const nav = await page.getByRole('navigation', { name: '移动底部导航' }).boundingBox()
    expect(preference!.y + preference!.height).toBeLessThanOrEqual(nav!.y)
  }
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
