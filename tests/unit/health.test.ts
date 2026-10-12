import { expect, test, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }))
import { prisma } from '@/lib/prisma'
import { GET } from '@/app/api/health/route'
test('健康响应不缓存，只给最小应用/数据库状态', async () => {
  vi.mocked(prisma.$transaction).mockResolvedValueOnce(undefined)
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ status: 'ok', version: '0.1.0', database: 'up' })
})
test('数据库异常503不泄露SQL或连接串', async () => {
  vi.mocked(prisma.$transaction).mockRejectedValueOnce(
    new Error('postgresql://secret SELECT password'),
  )
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ status: 'degraded', version: '0.1.0', database: 'down' })
})
