import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login, getSessionUser, changePassword, refresh } from '@/lib/services/auth'
import * as users from '@/lib/services/user'
import { POST as createRoute, GET as listRoute } from '@/app/api/v1/admin/users/route'
const prefix = `users-${Date.now()}`
const ids: string[] = []
let admin: string, adminToken: string, editorToken: string, viewerToken: string
const req = (
  token = adminToken,
  method = 'POST',
  origin: string | null = 'http://localhost:3000',
) =>
  new Request('http://localhost:3000/api/v1/admin/users', {
    method,
    headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
  })
async function fixture(role: 'ADMIN' | 'EDITOR' | 'VIEWER') {
  const user = await prisma.user.create({
    data: {
      name: prefix,
      email: `${prefix}-${ids.length}@example.com`,
      role,
      passwordHash: await bcrypt.hash('TestPass123', 4),
    },
  })
  ids.push(user.id)
  const credentials = await login(
    user.email,
    'TestPass123',
    { ip: `${prefix}-${ids.length}` },
    req('', 'POST'),
  )
  return { ...user, credentials }
}
async function create(role = 'EDITOR') {
  const result = await users.createUser(
    { name: prefix, email: `${prefix}-${ids.length}@example.com`, role },
    req(),
  )
  ids.push(result.user.id)
  return result
}
beforeAll(async () => {
  const db = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
  expect(db[0].name.endsWith('_test')).toBe(true)
  const a = await fixture('ADMIN')
  admin = a.id
  adminToken = a.credentials.accessToken
  editorToken = (await fixture('EDITOR')).credentials.accessToken
  viewerToken = (await fixture('VIEWER')).credentials.accessToken
})
afterAll(async () => {
  vi.restoreAllMocks()
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [{ key: { in: ids.map((id) => `adminwrite:${id}`) } }, { key: { contains: prefix } }],
    },
  })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})
test('三角色权限、GET无Origin、写Origin/共享限流与安全DTO', async () => {
  for (const token of [editorToken, viewerToken]) {
    await expect(
      users.listAdminUsers(new URLSearchParams(), req(token, 'GET', null)),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      users.createUser(
        { name: '拒绝', email: `${prefix}-denied@example.com`, role: 'EDITOR' },
        req(token),
      ),
    ).rejects.toMatchObject({ status: 403 })
  }
  await expect(users.createUser({}, req(adminToken, 'POST', null))).rejects.toMatchObject({
    status: 403,
  })
  const result = await users.listAdminUsers(
    new URLSearchParams({ q: prefix, active: 'true', pageSize: '1' }),
    req(adminToken, 'GET', null),
  )
  expect(result.data).toHaveLength(1)
  expect(result.meta).toMatchObject({ total: 3, page: 1, pageSize: 1, totalPages: 3 })
  expect(result.meta.activeAdmins).toBeGreaterThan(0)
  expect(Object.keys(result.data[0]).sort()).toEqual(
    [
      'id',
      'name',
      'email',
      'avatar',
      'role',
      'isActive',
      'lastLoginAt',
      'createdAt',
      'updatedAt',
      'revision',
    ].sort(),
  )
  const detail = await users.getAdminUser(admin, req(adminToken, 'GET', null))
  expect(detail).toMatchObject({ id: admin, revision: 1 })
  await expect(users.getAdminUser('missing', req(adminToken, 'GET', null))).rejects.toMatchObject({
    status: 404,
  })
  await expect(users.createUser({}, req())).rejects.toBeDefined()
  expect(
    await prisma.rateLimit.findUnique({ where: { key: `adminwrite:${admin}` } }),
  ).toMatchObject({ count: 1 })
  const route = await listRoute(req(adminToken, 'GET', null))
  expect(route.status).toBe(200)
  expect(route.headers.get('cache-control')).toBe('no-store')
})
test('随机密码可登录、bcrypt12、邮箱冲突和业务revision', async () => {
  const { user, temporaryPassword } = await create()
  expect(temporaryPassword).toMatch(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  expect(temporaryPassword.length).toBeGreaterThanOrEqual(24)
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  expect(bcrypt.getRounds(stored.passwordHash)).toBe(12)
  const credentials = await login(user.email, temporaryPassword, { ip: `${prefix}-random` }, req())
  expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
    revision: 1,
  })
  const changed = await users.updateUser(
    user.id,
    { revision: 1, name: '改名', avatar: null },
    req(),
  )
  expect(changed.revision).toBe(2)
  expect(await getSessionUser(req(credentials.accessToken, 'GET'))).toMatchObject({ id: user.id })
  await expect(
    users.updateUser(user.id, { revision: 1, name: '旧改动' }, req()),
  ).rejects.toMatchObject({ status: 409 })
  await expect(
    users.createUser({ name: '重复', email: user.email.toUpperCase(), role: 'VIEWER' }, req()),
  ).rejects.toMatchObject({ status: 409 })
  await changePassword(temporaryPassword, 'ChangedPass123', req(credentials.accessToken))
  expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
    revision: 3,
  })
  await expect(
    users.updateUser(user.id, { revision: 2, name: '旧密码版本' }, req()),
  ).rejects.toMatchObject({ status: 409 })
})
test('邮箱/角色/停用/重置/撤销在事务内即时撤销AT与轮转回复', async () => {
  const { user, temporaryPassword } = await create()
  let revision = 1,
    password = temporaryPassword,
    email = user.email
  for (const patch of [
    { email: `${prefix}-new@example.com` },
    { role: 'VIEWER' },
    { isActive: false },
  ]) {
    const credentials = await login(email, password, { ip: `${prefix}-lifecycle` }, req())
    const rotated = await refresh(credentials.refreshToken, { ip: `${prefix}-lifecycle` }, req())
    const result = await users.updateUser(user.id, { revision, ...patch }, req())
    revision++
    email = result.email
    await expect(getSessionUser(req(rotated.accessToken, 'GET'))).rejects.toMatchObject({
      status: 401,
    })
    await expect(
      refresh(credentials.refreshToken, { ip: `${prefix}-lifecycle` }, req()),
    ).rejects.toMatchObject({ status: 401 })
    expect(
      await prisma.session.count({ where: { userId: user.id, rotationReply: { not: null } } }),
    ).toBe(0)
  }
  await expect(login(email, password, { ip: `${prefix}-disabled` }, req())).rejects.toMatchObject({
    status: 403,
  })
  // 同一测试继续验收密码生命周期，重开仅本测试邮箱的登录窗口。
  await prisma.rateLimit.deleteMany({ where: { key: `login:email:${email}` } })
  await users.updateUser(user.id, { revision: revision++, isActive: true }, req())
  let credentials = await login(email, password, { ip: `${prefix}-reset` }, req())
  const reset = await users.resetUserPassword(user.id, { revision: revision++ }, req())
  password = reset.temporaryPassword
  await expect(getSessionUser(req(credentials.accessToken, 'GET'))).rejects.toMatchObject({
    status: 401,
  })
  await expect(
    login(email, temporaryPassword, { ip: `${prefix}-old` }, req()),
  ).rejects.toMatchObject({ status: 401 })
  credentials = await login(email, password, { ip: `${prefix}-new` }, req())
  const revoked = await users.revokeUserSessions(user.id, { revision: revision++ }, req())
  expect(revoked).toMatchObject({ user: { revision }, revoked: 1 })
  await expect(getSessionUser(req(credentials.accessToken, 'GET'))).rejects.toMatchObject({
    status: 401,
  })
  const audit = JSON.stringify(
    await prisma.auditLog.findMany({ where: { resource: 'user', resourceId: user.id } }),
  )
  for (const secret of [
    temporaryPassword,
    password,
    credentials.accessToken,
    'passwordHash',
    'rotationReply',
    'refreshHash',
  ])
    expect(audit.includes(secret)).toBe(false)
})
test('自己不能停用降级或使用管理密码/撤销入口', async () => {
  for (const patch of [{ role: 'EDITOR' }, { isActive: false }])
    await expect(users.updateUser(admin, { revision: 1, ...patch }, req())).rejects.toMatchObject({
      status: 422,
    })
  await expect(users.resetUserPassword(admin, { revision: 1 }, req())).rejects.toMatchObject({
    status: 422,
  })
  await expect(users.revokeUserSessions(admin, { revision: 1 }, req())).rejects.toMatchObject({
    status: 422,
  })
})
test('审计失败整次回滚用户与会话', async () => {
  const { user, temporaryPassword } = await create()
  const credentials = await login(
    user.email,
    temporaryPassword,
    { ip: `${prefix}-rollback` },
    req(),
  )
  const audit = await import('@/lib/services/audit')
  const spy = vi.spyOn(audit, 'writeAudit').mockRejectedValueOnce(new Error('审计故障'))
  await expect(users.updateUser(user.id, { revision: 1, isActive: false }, req())).rejects.toThrow(
    '审计故障',
  )
  spy.mockRestore()
  expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
    revision: 1,
    isActive: true,
  })
  expect(await getSessionUser(req(credentials.accessToken, 'GET'))).toMatchObject({ id: user.id })
})
test('并发管理员相互降级只允许一次，等待者重验权限，至少保留一位', async () => {
  const a = await fixture('ADMIN'),
    b = await fixture('ADMIN')
  const results = await Promise.allSettled([
    users.updateUser(b.id, { revision: 1, role: 'EDITOR' }, req(a.credentials.accessToken)),
    users.updateUser(a.id, { revision: 1, role: 'EDITOR' }, req(b.credentials.accessToken)),
  ])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  expect([401, 403, 409]).toContain(rejected.reason.status)
  expect(
    await prisma.user.count({ where: { id: { in: [a.id, b.id] }, role: 'ADMIN', isActive: true } }),
  ).toBe(1)
})
test('创建HTTP响应只一次返回密码且no-store', async () => {
  const request = new Request('http://localhost:3000/api/v1/admin/users', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: prefix, email: `${prefix}-http@example.com`, role: 'VIEWER' }),
  })
  const response = await createRoute(request)
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const payload = await response.json()
  ids.push(payload.data.user.id)
  expect(payload.data.temporaryPassword).toBeTruthy()
  expect(
    await users.getAdminUser(payload.data.user.id, req(adminToken, 'GET', null)),
  ).not.toHaveProperty('temporaryPassword')
})
test('旧邮箱登录等待用户锁时，邮箱变更提交后不得新建会话', async () => {
  const target = await fixture('EDITOR')
  const email = `${prefix}-login-race@example.com`
  const beforeSessions = await prisma.session.count({ where: { userId: target.id } })
  let reached!: () => void, release!: () => void
  const auditReached = new Promise<void>((resolve) => {
    reached = resolve
  })
  const commitGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const audit = await import('@/lib/services/audit')
  const realAudit = audit.writeAudit
  const spy = vi.spyOn(audit, 'writeAudit').mockImplementation(async (tx, event) => {
    const result = await realAudit(tx, event)
    if (event.resource === 'user' && event.action === 'update' && event.resourceId === target.id) {
      reached()
      await commitGate
    }
    return result
  })
  const updating = users.updateUser(target.id, { revision: 1, email }, req())
  let loggingIn: Promise<{ ok: boolean; status?: number; code?: string }> | undefined
  try {
    await auditReached
    loggingIn = login(target.email, 'TestPass123', { ip: `${prefix}-email-race` }, req()).then(
      () => ({ ok: true }),
      (error: { status: number; code: string }) => ({
        ok: false,
        status: error.status,
        code: error.code,
      }),
    )
    const deadline = Date.now() + 5000
    let waiting = false
    while (!waiting && Date.now() < deadline) {
      const activity = await prisma.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'SELECT * FROM users WHERE id=%FOR UPDATE%') AS waiting`
      waiting = activity[0].waiting
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(waiting).toBe(true)
    release()
    await updating
    expect(await loggingIn).toEqual({ ok: false, status: 401, code: 'INVALID_CREDENTIALS' })
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(beforeSessions)
    await expect(getSessionUser(req(target.credentials.accessToken, 'GET'))).rejects.toMatchObject({
      status: 401,
    })
    const credentials = await login(email, 'TestPass123', { ip: `${prefix}-email-new` }, req())
    expect(await getSessionUser(req(credentials.accessToken, 'GET'))).toMatchObject({
      id: target.id,
      email,
    })
  } finally {
    release()
    await updating.catch(() => undefined)
    await loggingIn
    spy.mockRestore()
  }
})
test('大小写邮箱唯一由数据库保护，命名改动不撤销；共享额度超限返回429', async () => {
  const { user } = await create()
  await expect(
    prisma.user.create({
      data: {
        name: prefix,
        email: user.email.toUpperCase(),
        passwordHash: 'unused',
        role: 'VIEWER',
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' })
  const limit = await prisma.rateLimit.findUniqueOrThrow({ where: { key: `adminwrite:${admin}` } })
  await prisma.rateLimit.update({
    where: { key: limit.key },
    data: { count: 120, expiresAt: new Date(Date.now() + 900000) },
  })
  try {
    await expect(
      users.updateUser(user.id, { revision: 1, name: '限流' }, req()),
    ).rejects.toMatchObject({ status: 429, headers: { 'Retry-After': expect.any(String) } })
    expect(await users.getAdminUser(user.id, req(adminToken, 'GET', null))).toMatchObject({
      revision: 1,
    })
  } finally {
    await prisma.rateLimit.update({
      where: { key: limit.key },
      data: { count: limit.count, expiresAt: limit.expiresAt },
    })
  }
})
