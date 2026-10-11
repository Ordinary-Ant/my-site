import { expect, test } from 'vitest'
import { issueVisitor, readVisitor, skipViewRequest } from '@/lib/visitor'
const secret = 'visitor-test-only-secret-32-characters'
test('匿名凭证签名隔离、固定30天且拒绝篡改及过期', () => {
  const token = issueVisitor(secret, 100000)
  expect(readVisitor(token, secret, 100001)).toMatch(/^[a-f0-9]{64}$/)
  expect(readVisitor(token, secret + 'x', 100001)).toBeNull()
  expect(readVisitor(token + 'x', secret, 100001)).toBeNull()
  expect(readVisitor(token, secret, 100000 + 30 * 86400)).toBeNull()
  expect(readVisitor(token, secret, 99900)).toBeNull()
  expect(readVisitor('invalid', secret, 100001)).toBeNull()
})
test('DNT/GPC及常见爬虫不统计', () => {
  for (const [name, value] of [
    ['DNT', '1'],
    ['Sec-GPC', '1'],
    ['User-Agent', 'Googlebot'],
    ['User-Agent', 'Bingbot'],
    ['User-Agent', 'curl/8.0'],
  ])
    expect(skipViewRequest(new Headers([[name, value]]))).toBe(true)
  expect(skipViewRequest(new Headers({ 'User-Agent': 'Mozilla/5.0' }))).toBe(false)
})
