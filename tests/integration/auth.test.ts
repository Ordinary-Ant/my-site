import { afterAll, beforeAll, expect, test } from 'vitest'
import bcrypt from 'bcryptjs'
import { prisma } from '../../src/lib/prisma'
import * as auth from '../../src/lib/services/auth'
import { consumeRateLimit } from '../../src/lib/services/rate-limit'
import { can } from '../../src/lib/auth/rbac'

const email = `auth-${Date.now()}@example.com`
const password = 'StrongPass123'
let userId: string
const request = (token: string, method = 'GET', origin = process.env.NEXT_PUBLIC_SITE_URL!) =>
  new Request('http://localhost:3000/api/test', {
    method,
    headers: { authorization: `Bearer ${token}`, origin },
  })
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email, name: '测试', passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN' },
    })
  ).id
})
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { contains: email } },
        { key: `authwrite:${userId}` },
        { key: `adminwrite:${userId}` },
      ],
    },
  })
  await prisma.$disconnect()
})

test('登录、数据库权限、停用与登出立即生效', async () => {
  const credentials = await auth.login(
    email.toUpperCase(),
    password,
    { ip: email },
    request('unused', 'POST'),
  )
  expect((await auth.requirePermission('user:manage', request(credentials.accessToken))).id).toBe(
    userId,
  )
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  await expect(
    auth.requirePermission('content:write', request(credentials.accessToken, 'POST')),
  ).rejects.toMatchObject({ status: 403 })
  expect((await auth.requirePermission('audit:read', request(credentials.accessToken))).role).toBe(
    'VIEWER',
  )
  await prisma.user.update({ where: { id: userId }, data: { isActive: false } })
  await expect(auth.getSessionUser(request(credentials.accessToken))).rejects.toMatchObject({
    status: 401,
  })
  await prisma.user.update({ where: { id: userId }, data: { isActive: true, role: 'ADMIN' } })
  await expect(
    auth.requirePermission(
      'content:write',
      request(credentials.accessToken, 'POST', 'https://evil.test'),
    ),
  ).rejects.toMatchObject({ status: 403 })
  await auth.logout(request(credentials.accessToken))
  await expect(auth.getSessionUser(request(credentials.accessToken))).rejects.toMatchObject({
    status: 401,
  })
})

test('真实PG并发刷新复用同一后继；超时重放提交全用户撤销', async () => {
  const initial = await auth.login(email, password, { ip: email }, request('unused', 'POST'))
  const replies = await Promise.all(
    Array.from({ length: 8 }, () =>
      auth.refresh(initial.refreshToken, { ip: email }, request('unused', 'POST')),
    ),
  )
  expect(new Set(replies.map((r) => r.refreshToken)).size).toBe(1)
  expect(new Set(replies.map((r) => r.accessToken)).size).toBe(1)
  await prisma.session.update({
    where: { id: replies[0].user.sessionId },
    data: { revokedAt: new Date() },
  })
  await prisma.session.create({
    data: { userId, refreshHash: email, expiresAt: new Date(Date.now() + 60000) },
  })
  await expect(
    auth.refresh(initial.refreshToken, { ip: email }, request('unused', 'POST')),
  ).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  })
  expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(1)
  await prisma.session.update({
    where: { id: initial.user.sessionId },
    data: { rotatedAt: new Date(Date.now() - 11000) },
  })
  await expect(
    auth.refresh(initial.refreshToken, { ip: email }, request('unused', 'POST')),
  ).rejects.toMatchObject({
    code: 'TOKEN_REUSED',
  })
  expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0)
  expect(await prisma.auditLog.count({ where: { userId, action: 'token-reused' } })).toBe(1)
})

test('三角色矩阵与32并发共享限流不超额度', async () => {
  expect(can('EDITOR', 'audit:read')).toBe(false)
  expect(can('EDITOR', 'content:publish')).toBe(true)
  expect(can('VIEWER', 'dashboard:read')).toBe(true)
  const key = `concurrency:${email}`
  const results = await Promise.allSettled(
    Array.from({ length: 32 }, () => consumeRateLimit(key, 5, 900000)),
  )
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(27)
})

test('密码修改撤销其他会话、过期AT拒绝、API标准错误不暴露异常', async () => {
  const a = await auth.login(email, password, { ip: email }, request('unused', 'POST'))
  const b = await auth.login(email, password, { ip: email }, request('unused', 'POST'))
  await auth.changePassword(password, 'ChangedPass123', request(a.accessToken, 'POST'))
  await expect(auth.getSessionUser(request(b.accessToken))).rejects.toMatchObject({ status: 401 })
  expect((await auth.getSessionUser(request(a.accessToken))).id).toBe(userId)
  const { SignJWT } = await import('jose')
  const token = await new SignJWT({ sid: a.user.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  await expect(auth.getSessionUser(request(token))).rejects.toMatchObject({ status: 401 })
  const { apiHandler } = await import('../../src/lib/api/http')
  const response = await apiHandler(() => {
    throw new Error('secret-password')
  })(new Request('http://localhost/test'))
  expect(response.status).toBe(500)
  expect(JSON.stringify(await response.json())).not.toContain('secret-password')
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('service写入口必须核对Origin且登录失败使用统一错误', async () => {
  const credentials = await auth.login(
    email,
    'ChangedPass123',
    { ip: email },
    request('unused', 'POST'),
  )
  const noOrigin = new Request('http://localhost/api', {
    method: 'POST',
    headers: { authorization: `Bearer ${credentials.accessToken}` },
  })
  await expect(auth.logout(noOrigin)).rejects.toMatchObject({ code: 'INVALID_ORIGIN' })
  await expect(
    auth.login(email, 'bad', { ip: email }, request('unused', 'POST')),
  ).rejects.toMatchObject({
    code: 'RATE_LIMITED',
  })
  await expect(
    auth.login(`unknown-${email}`, 'bad', { ip: `other-${email}` }, request('unused', 'POST')),
  ).rejects.toMatchObject({
    code: 'INVALID_CREDENTIALS',
  })
})

test('Auth路由本地HTTP可登录、cookie属性、会话列表与撤销实际生效', async () => {
  const loginRoute = await import('../../src/app/api/v1/auth/login/route')
  const apiEmail = `api-${email}`
  const apiUser = await prisma.user.create({
    data: {
      email: apiEmail,
      name: '接口测试',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'EDITOR',
    },
  })
  await prisma.rateLimit.deleteMany({ where: { key: 'login:ip:unknown' } })
  try {
    const makeRequest = (url: string, method: string, token?: string, body?: unknown) =>
      new Request(`http://localhost:3000/api/v1/auth/${url}`, {
        method,
        headers: {
          origin: process.env.NEXT_PUBLIC_SITE_URL!,
          'content-type': 'application/json',
          ...(token ? { cookie: `at=${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    const response = await loginRoute.POST(
      makeRequest('login', 'POST', undefined, { email: apiEmail, password }),
    )
    expect(response.status).toBe(200)
    const invalid = await loginRoute.POST(
      makeRequest('login', 'POST', undefined, { email: 'invalid', password: '' }),
    )
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    )
    await prisma.user.update({ where: { id: apiUser.id }, data: { isActive: false } })
    await expect(
      auth.login(apiEmail, password, { ip: apiEmail }, request('unused', 'POST')),
    ).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_DISABLED',
    })
    await prisma.user.update({ where: { id: apiUser.id }, data: { isActive: true } })
    const setCookies = response.headers.get('set-cookie')!
    expect(setCookies).toContain('HttpOnly')
    expect(setCookies).toContain('SameSite=lax')
    expect(setCookies).toContain('SameSite=strict')
    expect(setCookies).not.toContain('Secure')
    const token = setCookies.match(/at=([^;]+)/)![1]
    const { GET } = await import('../../src/app/api/v1/auth/sessions/route')
    const sessionsResponse = await GET(makeRequest('sessions', 'GET', token))
    const sessions = (await sessionsResponse.json()).data
    expect(sessions).toHaveLength(1)
    expect(JSON.stringify(sessions)).not.toContain('refreshHash')
    const { DELETE } = await import('../../src/app/api/v1/auth/sessions/[id]/route')
    expect((await DELETE(makeRequest(`sessions/${sessions[0].id}`, 'DELETE', token))).status).toBe(
      200,
    )
    await expect(auth.getSessionUser(request(token))).rejects.toMatchObject({ status: 401 })
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: apiUser.id } })
    await prisma.user.delete({ where: { id: apiUser.id } })
    await prisma.rateLimit.deleteMany({ where: { key: 'login:ip:unknown' } })
    await prisma.rateLimit.deleteMany({ where: { key: `authwrite:${apiUser.id}` } })
  }
})

test('代理IP默认忽略，显式可信代理仅接受合法地址', () => {
  const before = process.env.TRUST_PROXY
  try {
    process.env.TRUST_PROXY = 'false'
    const incoming = new Request('http://localhost/api', {
      headers: { 'x-forwarded-for': '203.0.113.1, 127.0.0.1' },
    })
    expect(auth.requestInfo(incoming).ip).toBe('unknown')
    process.env.TRUST_PROXY = 'true'
    expect(auth.requestInfo(incoming).ip).toBe('203.0.113.1')
    expect(
      auth.requestInfo(
        new Request('http://localhost/api', { headers: { 'x-forwarded-for': 'malformed' } }),
      ).ip,
    ).toBe('unknown')
  } finally {
    if (before === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = before
  }
})

test('审计时间保留ISO、敏感嵌套字段移除', async () => {
  const { writeAudit } = await import('../../src/lib/services/audit')
  const at = new Date('2026-10-07T00:00:00Z')
  const result = await writeAudit(prisma, {
    userId,
    action: 'test',
    resource: 'test',
    after: {
      at,
      passwordHash: 'secret',
      nested: { accessToken: 'secret', value: 'safe', optional: undefined },
    },
  })
  expect(result.after).toEqual({ at: at.toISOString(), nested: { value: 'safe' } })
})

test('密码并发修改只有一次成功，bcrypt等价旧密码不能伪装成新密码', async () => {
  const testEmail = `password-${email}`
  const current = 'A1' + 'x'.repeat(70)
  const record = await prisma.user.create({
    data: {
      email: testEmail,
      name: '密码测试',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(current, 12),
    },
  })
  try {
    const credentials = await auth.login(
      testEmail,
      current,
      { ip: testEmail },
      request('unused', 'POST'),
    )
    const req = request(credentials.accessToken, 'POST')
    await expect(auth.changePassword(current, current + 'x', req)).rejects.toMatchObject({
      status: 422,
    })
    const results = await Promise.allSettled([
      auth.changePassword(current, 'FirstNew123', req),
      auth.changePassword(current, 'SecondNew123', req),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: record.id } })
    await prisma.user.delete({ where: { id: record.id } })
    await prisma.rateLimit.deleteMany({
      where: { OR: [{ key: { contains: testEmail } }, { key: `authwrite:${record.id}` }] },
    })
  }
})

test('数据库唯一冲突与不存在记录映射标准409和404', async () => {
  const { apiHandler, ok } = await import('../../src/lib/api/http')
  const duplicate = await apiHandler(async () =>
    ok(
      await prisma.user.create({
        data: { email, name: '重复', passwordHash: 'never-store', role: 'VIEWER' },
      }),
    ),
  )(new Request('http://localhost/test'))
  expect(duplicate.status).toBe(409)
  expect((await duplicate.json()).error).toMatchObject({
    code: 'CONFLICT',
    details: expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
  })
  const missing = await apiHandler(async () =>
    ok(
      await prisma.user.update({ where: { id: 'missing-auth-fixture' }, data: { name: '不存在' } }),
    ),
  )(new Request('http://localhost/test'))
  expect(missing.status).toBe(404)
  expect((await missing.json()).error.code).toBe('NOT_FOUND')
})

test('登录刷新服务核验Origin，写权限即使GET也不得绕过', async () => {
  const fixtureEmail = `origin-${email}`
  const fixture = await prisma.user.create({
    data: {
      email: fixtureEmail,
      name: '来源测试',
      passwordHash: await bcrypt.hash(password, 4),
      role: 'ADMIN',
    },
  })
  const allowed = request('unused', 'POST')
  const denied = new Request('http://localhost/api', { method: 'GET' })
  try {
    await expect(
      auth.login(fixtureEmail, password, { ip: fixtureEmail }, denied),
    ).rejects.toMatchObject({ code: 'INVALID_ORIGIN' })
    const credentials = await auth.login(fixtureEmail, password, { ip: fixtureEmail }, allowed)
    await expect(
      auth.refresh(credentials.refreshToken, { ip: fixtureEmail }, denied),
    ).rejects.toMatchObject({ code: 'INVALID_ORIGIN' })
    const readMethod = new Request('http://localhost/api', {
      method: 'GET',
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    })
    await expect(auth.requirePermission('content:write', readMethod)).rejects.toMatchObject({
      code: 'INVALID_ORIGIN',
    })
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: fixture.id } })
    await prisma.user.delete({ where: { id: fixture.id } })
    await prisma.rateLimit.deleteMany({ where: { key: { contains: fixtureEmail } } })
  }
})

test('用户密码锁阻止旧认证结果继续创建会话', async () => {
  const fixtureEmail = `login-lock-${email}`
  const fixture = await prisma.user.create({
    data: {
      email: fixtureEmail,
      name: '登录并发测试',
      passwordHash: await bcrypt.hash(password, 4),
      role: 'ADMIN',
    },
  })
  let release!: () => void
  let acquired!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const locked = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${fixture.id} FOR NO KEY UPDATE`
      acquired()
      await gate
      await tx.user.update({
        where: { id: fixture.id },
        data: { passwordHash: await bcrypt.hash('ChangedLock123', 4) },
      })
    },
    { timeout: 15000 },
  )
  await ready
  const pending = auth.login(
    fixtureEmail,
    password,
    { ip: fixtureEmail },
    request('unused', 'POST'),
  )
  // 登录完成旧密码核验并等待事务锁，再提交密码修改。
  const waitingUntil = Date.now() + 5000
  let waiting = false
  while (Date.now() < waitingUntil) {
    const rows = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query NOT LIKE '%pg_stat_activity%'`
    if (Number(rows[0].count) > 0) {
      waiting = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  release()
  try {
    expect(waiting).toBe(true)
    await locked
    await expect(pending).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(await prisma.session.count({ where: { userId: fixture.id, revokedAt: null } })).toBe(0)
  } finally {
    release()
    await locked
    await prisma.auditLog.deleteMany({ where: { userId: fixture.id } })
    await prisma.user.delete({ where: { id: fixture.id } })
    await prisma.rateLimit.deleteMany({ where: { key: { contains: fixtureEmail } } })
  }
})

for (const operation of ['logout-all', 'password', 'replay', 'logout', 'revoke'] as const) {
  test(`真实PG交错${operation}撤销不会遗漏刷新后继`, async () => {
    const suffix = Date.now().toString()
    const fixtureEmail = `interleave-${operation}-${email}`
    const fixture = await prisma.user.create({
      data: {
        email: fixtureEmail,
        name: '交错测试',
        passwordHash: await bcrypt.hash(password, 4),
        role: 'ADMIN',
      },
    })
    const origin = request('unused', 'POST')
    const initial = await auth.login(fixtureEmail, password, { ip: fixtureEmail }, origin)
    const caller = await auth.login(fixtureEmail, password, { ip: fixtureEmail }, origin)
    let token = initial.refreshToken
    if (operation === 'replay') {
      token = (await auth.refresh(token, { ip: fixtureEmail }, origin)).refreshToken
      await prisma.session.update({
        where: { id: initial.user.sessionId },
        data: { rotatedAt: new Date(Date.now() - 11000) },
      })
    }
    // 只拦截本测试用户的新会话，闸门确保撤销查询与未提交INSERT交错。
    if (!/^[a-z0-9]+$/.test(fixture.id)) throw new Error('不安全的测试ID')
    const functionName = `auth_gate_${suffix}`
    const triggerName = `auth_trigger_${suffix}`
    const key = BigInt(suffix)
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`,
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON sessions FOR EACH ROW WHEN (NEW."userId" = '${fixture.id}') EXECUTE FUNCTION ${functionName}()`,
    )
    let release!: () => void
    let acquired!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const locked = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::text`
        acquired()
        await gate
      },
      { timeout: 15000 },
    )
    await ready
    let rotating: Promise<unknown> | undefined
    let revoking: Promise<unknown> | undefined
    const waitLocks = async (count: number) => {
      const until = Date.now() + 5000
      while (Date.now() < until) {
        const rows = await prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query NOT LIKE '%pg_stat_activity%'`
        if (Number(rows[0].count) >= count) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error('未观察到预期PG锁等待')
    }
    try {
      rotating = auth.refresh(token, { ip: fixtureEmail }, origin)
      await waitLocks(1)
      revoking =
        operation === 'logout-all'
          ? auth.logoutAll(request(caller.accessToken, 'POST'))
          : operation === 'logout'
            ? auth.logout(request(initial.accessToken, 'POST'))
            : operation === 'revoke'
              ? auth.revokeSession(initial.user.sessionId, request(caller.accessToken, 'POST'))
              : operation === 'password'
                ? auth.changePassword(
                    password,
                    'ChangedInterleave123',
                    request(caller.accessToken, 'POST'),
                  )
                : auth.refresh(initial.refreshToken, { ip: fixtureEmail }, origin)
      const captured = Promise.allSettled([rotating, revoking])
      await waitLocks(2)
      release()
      await locked
      const results = await captured
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe(operation === 'replay' ? 'rejected' : 'fulfilled')
      if (operation === 'replay' && results[1].status === 'rejected')
        expect(results[1].reason.code).toBe('TOKEN_REUSED')
      const live = await prisma.session.findMany({ where: { userId: fixture.id, revokedAt: null } })
      expect(live.map((session) => session.id)).toEqual(
        ['password', 'logout', 'revoke'].includes(operation) ? [caller.user.sessionId] : [],
      )
    } finally {
      release()
      await locked
      await Promise.allSettled(
        [rotating, revoking].filter((promise): promise is Promise<unknown> => !!promise),
      )
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON sessions`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`)
      await prisma.auditLog.deleteMany({ where: { userId: fixture.id } })
      await prisma.user.delete({ where: { id: fixture.id } })
      await prisma.rateLimit.deleteMany({
        where: { OR: [{ key: { contains: fixtureEmail } }, { key: `authwrite:${fixture.id}` }] },
      })
    }
  })
}
