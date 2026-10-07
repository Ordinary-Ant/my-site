import { expect, test } from 'vitest'
import { safeNext } from '@/lib/api/client'
test('登录跳转拒绝外站、编码和控制字符，保留站内查询', () => {
  for (const value of [
    'https://evil.test',
    '//evil.test',
    '/%2fevil.test',
    '/\\evil.test',
    '/%5cevil.test',
    '/%0aevil',
    null,
  ])
    expect(safeNext(value)).toBe('/admin')
  expect(safeNext('/admin/articles/new?draft=1')).toBe('/admin/articles/new?draft=1')
})
