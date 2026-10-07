import { beforeAll, afterAll, test, expect, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import * as audit from '@/lib/services/audit'
let token: string, userId: string
const req = () =>
  new Request('http://localhost:3000/api/v1/admin/audit-logs', {
    headers: { authorization: `Bearer ${token}` },
  })
beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      name: '审计验收',
      email: `audit-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'VIEWER',
    },
  })
  userId = u.id
  token = (
    await login(
      u.email,
      'TestPass123',
      { ip: u.id },
      new Request('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      }),
    )
  ).accessToken
})
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('审计分页过滤且历史密钥脱敏，用户只公开name/id', async () => {
  expect(audit.listAuditLogs).toBeTypeOf('function')
  await prisma.auditLog.create({
    data: {
      userId,
      resource: 'module',
      resourceId: 'log',
      action: 'update',
      before: { password: 'hidden', enabled: true },
      after: { token: 'hidden', enabled: false },
    },
  })
  const result = await audit.listAuditLogs(
    new URLSearchParams({ resource: 'module', userId, action: 'update', pageSize: '1' }),
    req(),
  )
  expect(result.data).toHaveLength(1)
  expect(result.data[0].user).toEqual({ id: userId, name: '审计验收' })
  expect(JSON.stringify(result)).not.toContain('hidden')
  expect(result.meta.total).toBe(1)
})
