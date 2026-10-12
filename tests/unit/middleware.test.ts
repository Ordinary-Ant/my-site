import { beforeEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const queries = vi.hoisted(() => ({ modules: vi.fn(), aliases: vi.fn() }))
const routeFetch = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    module: { findMany: queries.modules },
    routeAlias: { findMany: queries.aliases },
  },
}))
import { middleware } from '@/middleware'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', routeFetch)
  routeFetch.mockResolvedValue(Response.json({ target: '/writing/hello' }))
  queries.modules.mockResolvedValue([{ key: 'article', route: '/writing' }])
  queries.aliases.mockResolvedValue([{ moduleKey: 'article', path: '/articles' }])
})

test('固定首页不查询可变栏目路由，仍生成并透传每请求CSP nonce', async () => {
  const first = await middleware(new NextRequest('http://localhost/'))
  const second = await middleware(new NextRequest('http://localhost/'))
  expect(queries.modules).not.toHaveBeenCalled()
  expect(queries.aliases).not.toHaveBeenCalled()
  expect(routeFetch).not.toHaveBeenCalled()
  const nonce = first.headers.get('x-middleware-request-x-nonce')
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{32}$/)
  expect(first.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`)
  expect(second.headers.get('x-middleware-request-x-nonce')).not.toBe(nonce)
})

test('非固定路径仍查询历史别名并301保留详情及查询参数', async () => {
  const response = await middleware(new NextRequest('http://localhost/articles/hello?from=old'))
  expect(routeFetch).toHaveBeenCalledOnce()
  expect(typeof routeFetch.mock.calls[0][0]).toBe('string')
  expect(queries.modules).not.toHaveBeenCalled()
  expect(queries.aliases).not.toHaveBeenCalled()
  expect(response.status).toBe(301)
  expect(response.headers.get('Location')).toBe('http://localhost/writing/hello?from=old')
  expect(response.headers.get('Content-Security-Policy')).toContain('nonce-')
})

test('路由服务失败返回503，保留安全头且不吞掉故障', async () => {
  routeFetch.mockRejectedValueOnce(new Error('unavailable'))
  const response = await middleware(new NextRequest('http://localhost/articles/hello'))
  expect(response.status).toBe(503)
  expect(response.headers.get('Content-Security-Policy')).toContain('nonce-')
})

test('路由服务不能让中间件跳转到外部站点', async () => {
  routeFetch.mockResolvedValueOnce(Response.json({ target: '//evil.example/path' }))
  const response = await middleware(new NextRequest('http://localhost/articles/hello'))
  expect(response.status).toBe(503)
  expect(response.headers.get('Location')).toBeNull()
})

test('边缘环境没有AbortSignal.timeout时仍能查询别名', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    throw new TypeError('AbortSignal.timeout is not a function')
  })
  try {
    const response = await middleware(new NextRequest('http://localhost/articles/hello'))
    expect(response.status).toBe(301)
    expect(routeFetch).toHaveBeenCalledOnce()
  } finally {
    timeout.mockRestore()
  }
})

test('查询失败只返回固定阶段码，不泄露异常内容', async () => {
  routeFetch.mockResolvedValueOnce(new Response('private upstream data', { status: 502 }))
  const response = await middleware(new NextRequest('http://localhost/articles'))
  expect(response.status).toBe(503)
  expect(response.headers.get('X-Route-Failure')).toBe('HTTP_502')
  expect(await response.text()).not.toContain('private')
})
