import { expect, test, vi } from 'vitest'
import { api, ClientError, safeNext } from '@/lib/api/client'
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

test('接口校验失败保留字段路径，供表单定位而不丢失限流信息', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: '输入格式不正确',
            details: [{ path: 'coverImage', message: '媒体地址不安全' }],
          },
        }),
        { status: 400, headers: { 'retry-after': '3' } },
      ),
    ),
  )
  try {
    const error = await api('/api/v1/admin/logs').catch((error) => error)
    expect(error).toBeInstanceOf(ClientError)
    expect(error.details).toEqual([{ path: 'coverImage', message: '媒体地址不安全' }])
    expect(error.retryAfter).toBe(3)
  } finally {
    vi.unstubAllGlobals()
  }
})
