import { expect, test, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { apiHandler } from '@/lib/api/http'

test('数据库故障日志保留固定诊断码，不记录SQL、连接信息或meta消息', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const handler = apiHandler(async () => {
      throw new Prisma.PrismaClientKnownRequestError('SELECT secret_password', {
        code: 'P2010',
        clientVersion: '6.19.3',
        meta: { code: '42P01', message: 'postgresql://secret' },
      })
    })
    const response = await handler(new Request('http://localhost/api/test'))
    expect(response.status).toBe(500)
    expect(log).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      requestId: expect.any(String),
      databaseCode: 'P2010',
      sqlState: '42P01',
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    expect(await response.text()).not.toContain('42P01')
  } finally {
    log.mockRestore()
  }
})
