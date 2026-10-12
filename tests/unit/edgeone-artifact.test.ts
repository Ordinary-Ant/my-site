import { expect, test } from 'vitest'
import { sanitizeEdgeEnvironment } from '../../scripts/prepare-edgeone-artifact.mjs'

test('边缘产物仅保留公开白名单，移除构建数据库、JWT及其他进程变量', () => {
  const source =
    'run({env: ' +
    JSON.stringify({
      DATABASE_URL: 'private-db',
      JWT_SECRET: 'private-jwt',
      HOME: '/root',
      NEXT_PUBLIC_SITE_URL: 'https://site.example',
    }) +
    '});'
  const result = sanitizeEdgeEnvironment(source, {
    NEXT_PUBLIC_SITE_URL: 'https://site.example',
    S3_ENDPOINT: 'https://storage.example/s3',
  })
  expect(result.replacements).toBe(1)
  expect(result.code).not.toContain('private-db')
  expect(result.code).not.toContain('private-jwt')
  expect(result.code).not.toContain('HOME')
  expect(result.code).toContain('storage.example')
  expect(result.code).toContain('production')
})

test('JSON字符串中的括号和转义不破坏生成脚本，外部逻辑保持', () => {
  const result = sanitizeEdgeEnvironment(
    'before();call({env: ' +
      JSON.stringify({ JWT_SECRET: 'x}\\"y' }) +
      ',waitUntil: later});after();',
    { NEXT_PUBLIC_SITE_URL: 'https://site.example' },
  )
  expect(result.code).toContain('waitUntil: later});after();')
  expect(result.code).not.toContain('JWT_SECRET')
})

test('拒绝不安全站点Origin或带凭据存储地址', () => {
  expect(() =>
    sanitizeEdgeEnvironment('env: {}', { NEXT_PUBLIC_SITE_URL: 'http://site.example' }),
  ).toThrow()
  expect(() =>
    sanitizeEdgeEnvironment('env: {}', {
      NEXT_PUBLIC_SITE_URL: 'https://site.example',
      S3_ENDPOINT: 'https://user:password@storage.example',
    }),
  ).toThrow()
})
