import { testBaseURL } from './base-url'
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
test('分钟调度机器凭据校验与实际60秒运行周期', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== '1440', '单实例实际计时即可验证调度，无需重复三次')
  testInfo.setTimeout(90000)
  expect((await request.get('/api/v1/jobs/publication')).status()).toBe(401)
  const worker = spawn(process.execPath, ['scripts/run-publication-job.mjs'], {
    env: {
      ...process.env,
      REVALIDATE_SECRET: 'e2e-only-publication-machine-secret-32-chars',
      NEXT_PUBLIC_SITE_URL: testBaseURL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const times: number[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('分钟发布调度未在预期时间完成两次')), 75000)
      worker.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      worker.stdout.on('data', (data) => {
        if (String(data).includes('发布调度完成')) {
          times.push(Date.now())
          if (times.length === 2) {
            clearTimeout(timer)
            resolve()
          }
        }
      })
      worker.stderr.on('data', (data) => {
        if (String(data).includes('发布调度')) {
          clearTimeout(timer)
          reject(new Error('发布调度失败'))
        }
      })
      worker.once('exit', (code) => {
        if (times.length < 2) {
          clearTimeout(timer)
          reject(new Error(`发布调度提前退出：${code}`))
        }
      })
    })
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(58000)
    expect(times[1] - times[0]).toBeLessThan(70000)
  } finally {
    worker.kill()
  }
})
