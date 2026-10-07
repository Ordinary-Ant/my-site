import { expect, test } from '@playwright/test'

test('首页三端可读且没有横向溢出', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
