import { expect, test } from 'vitest'
import { contentSecurityPolicy } from '@/lib/csp'

test('生产nonce只允许受信脚本，R2连接仅取无凭据HTTPS origin', () => {
  const value = contentSecurityPolicy('testNonce', {
    production: true,
    siteUrl: 'https://example.com',
    storageEndpoint: 'https://bucket.example.com/path',
  })
  expect(value).toContain("script-src 'self' 'nonce-testNonce' 'strict-dynamic'")
  expect(value).not.toContain('unsafe-eval')
  expect(value).toContain("connect-src 'self' https://bucket.example.com")
  expect(value).toContain('upgrade-insecure-requests')
  expect(value).toContain("object-src 'none'")
})
test('localhost生产HTTP不升级，拒绝注入与带凭据R2地址', () => {
  const value = contentSecurityPolicy('testNonce', {
    production: true,
    siteUrl: 'http://localhost:3100',
    storageEndpoint: 'https://user:pass@bucket.example.com',
  })
  expect(value).not.toContain('upgrade-insecure-requests')
  expect(value).not.toContain('bucket.example.com')
  expect(() =>
    contentSecurityPolicy("bad';", { production: true, siteUrl: 'http://localhost' }),
  ).toThrow()
})
