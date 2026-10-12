import { expect, test } from '@playwright/test'

test('CSP每请求nonce与主题脚本一致，拒绝注入且预览受保护，健康探针可用', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as { violations: string[]; cspAttack?: boolean }
    host.violations = []
    document.addEventListener('securitypolicyviolation', (event) =>
      host.violations.push(event.effectiveDirective),
    )
  })
  await page.setExtraHTTPHeaders({
    'x-nonce': 'attacker-chosen',
    'content-security-policy': "script-src 'unsafe-inline'",
  })
  const response = (await page.goto('/'))!
  const csp = response.headers()['content-security-policy']
  expect(csp).toBeTruthy()
  expect(csp).not.toContain('attacker-chosen')
  expect(csp).not.toContain('unsafe-eval')
  const nonce = csp.match(/'nonce-([^']+)'/)![1]
  const scripts = await page
    .locator('script:not([src])')
    .evaluateAll((elements) => elements.map((el) => (el as HTMLScriptElement).nonce))
  expect(scripts.length).toBeGreaterThan(1)
  expect(scripts.every((value) => value === nonce)).toBe(true)
  await page.getByLabel('动态效果偏好').selectOption('off')
  expect(
    await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
  ).toEqual([])
  // 模拟HTML注入；strict-dynamic允许可信脚本创建子脚本，不能用CDP evaluate冒充不可信解析器。
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const original = await route.fetch()
      const html = await original.text()
      await route.fulfill({
        response: original,
        body: html.replace('</head>', '<script>window.cspAttack = true</script></head>'),
      })
    },
    { times: 1 },
  )
  await page.reload()
  expect(
    await page.evaluate(() => (window as unknown as { cspAttack?: boolean }).cspAttack),
  ).not.toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { violations: string[] }).violations))
    .toContain('script-src-elem')
  const preview = await page.request.get('/preview/invalid')
  expect(preview.headers()['content-security-policy']).toContain("'nonce-")
  expect(preview.headers()['x-robots-tag']).toContain('noindex')
  const health = await page.request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok', version: '0.1.0', database: 'up' })
  expect(health.headers()['cache-control']).toBe('no-store')
  const login = (await page.goto('/login'))!
  expect(login.headers()['content-security-policy']).not.toContain(nonce)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { violations: string[] }).violations),
  ).toEqual([])
})
