import { existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}
const testUrl = process.env.TEST_DATABASE_URL
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('集成测试必须提供独立 TEST_DATABASE_URL，库名以 _test 结尾')
process.env.DATABASE_URL = testUrl
process.env.JWT_SECRET ??= 'test-only-secret-with-at-least-32-characters'
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000'
