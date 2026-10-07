import { defineConfig, devices } from '@playwright/test'

/** 冒烟测试使用真实服务与数据库，三端共用验收场景。 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: '390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: '820', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 } } },
    {
      name: '1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
