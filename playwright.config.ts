import { defineConfig, devices } from '@playwright/test'
import { testBaseURL } from './tests/e2e/base-url'
const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('E2E必须使用独立TEST_DATABASE_URL，库名以_test结尾')

/** 冒烟测试使用真实服务与数据库，三端共用验收场景。 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/setup.ts',
  use: { baseURL: testBaseURL, trace: 'retain-on-failure' },
  projects: [
    { name: '390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: '820', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 } } },
    {
      name: '1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: 'npm run start -- --port ' + (new URL(testBaseURL).port || '80'),
    url: testBaseURL,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: testUrl,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: testBaseURL,
      REVALIDATE_SECRET: 'e2e-only-publication-machine-secret-32-chars',
    },
    timeout: 60000,
  },
})
