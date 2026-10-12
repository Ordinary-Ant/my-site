import { beforeEach, expect, test, vi } from 'vitest'

const queries = vi.hoisted(() => ({ modules: vi.fn(), aliases: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { module: { findMany: queries.modules }, routeAlias: { findMany: queries.aliases } },
}))
import { GET } from '@/app/api/v1/route-redirect/route'

beforeEach(() => {
  vi.clearAllMocks()
  queries.modules.mockResolvedValue([{ key: 'article', route: '/writing' }])
  queries.aliases.mockResolvedValue([{ moduleKey: 'article', path: '/articles' }])
})

test('仅返回唯一最新相对路径，详情后缀保留且不缓存', async () => {
  const response = await GET(
    new Request('http://localhost/api/v1/route-redirect?path=%2Farticles%2Fhello'),
  )
  expect(await response.json()).toEqual({ target: '/writing/hello' })
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

test.each(['//external/path', '/x?secret=1', '/x#hash', '/a\\b', '/x/../admin', '/%2e%2e/admin'])(
  '拒绝非规范pathname：%s',
  async (path) => {
    const response = await GET(
      new Request('http://localhost/api/v1/route-redirect?path=' + encodeURIComponent(path)),
    )
    expect(response.status).toBe(400)
    expect(queries.modules).not.toHaveBeenCalled()
  },
)
