import 'server-only'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { Prisma, type User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api/errors'
import { assertOrigin, getSessionUser, type SessionUser } from './auth'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'
import {
  UserCreateSchema,
  UserUpdateSchema,
  UserListSchema,
  UserRevisionSchema,
} from '@/lib/validators/user'

const select = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  revision: true,
} satisfies Prisma.UserSelect
export type AdminUser = Pick<User, keyof typeof select>
const dto = (user: User): AdminUser =>
  Object.fromEntries(Object.keys(select).map((key) => [key, user[key as keyof User]])) as AdminUser
const conflict = () => new ApiError(409, 'REVISION_CONFLICT', '用户已修改，请刷新后比较最新版本')
const missing = () => new ApiError(404, 'NOT_FOUND', '用户不存在')
const rule = (message: string) => new ApiError(422, 'BUSINESS_RULE_VIOLATION', message)
const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', '请重新登录')
async function authorize(request?: Request, write = false) {
  const actor = await getSessionUser(request)
  if (actor.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '没有用户管理权限')
  if (write) {
    await assertOrigin(request)
    await consumeRateLimit(`adminwrite:${actor.id}`, 120, 900000)
  }
  return actor
}
async function transaction<T>(
  actor: SessionUser,
  targetId: string | undefined,
  operation: (tx: Prisma.TransactionClient, target?: User) => Promise<T>,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // 管理写入串行化，用户按ID上锁，始终先用户后会话。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(74390233)`
        const ids = [...new Set([actor.id, ...(targetId ? [targetId] : [])])].sort()
        const rows = await tx.$queryRaw<User[]>(
          Prisma.sql`SELECT * FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        )
        const current = rows.find((u) => u.id === actor.id)
        if (!current?.isActive) throw unauthorized()
        if (current.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '没有用户管理权限')
        let session = await tx.session.findUnique({ where: { id: actor.sessionId } })
        const seen = new Set<string>()
        while (session && session.userId === actor.id && !seen.has(session.id)) {
          seen.add(session.id)
          if (!session.revokedAt && session.expiresAt > new Date()) break
          if (
            !session.rotatedAt ||
            Date.now() - session.rotatedAt.getTime() > 10000 ||
            !session.successorId
          )
            throw unauthorized()
          session = await tx.session.findUnique({ where: { id: session.successorId } })
        }
        if (
          !session ||
          session.userId !== actor.id ||
          session.revokedAt ||
          session.expiresAt <= new Date()
        )
          throw unauthorized()
        const target = targetId ? rows.find((u) => u.id === targetId) : undefined
        if (targetId && !target) throw missing()
        return operation(tx, target)
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
        maxWait: 5000,
      },
    )
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ApiError(409, 'EMAIL_CONFLICT', '邮箱已被使用')
      if (
        ['P2034', 'P2025'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
      )
        throw conflict()
    }
    throw error
  }
}
const randomPassword = () => `Aa1${randomBytes(24).toString('base64url')}`
async function revoke(tx: Prisma.TransactionClient, id: string) {
  const active = await tx.session.count({
    where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
  })
  await tx.session.updateMany({
    where: { userId: id },
    data: { revokedAt: new Date(), rotationReply: null },
  })
  return active
}
export async function listAdminUsers(params = new URLSearchParams(), request?: Request) {
  await authorize(request)
  const { q, role, active, page, pageSize } = UserListSchema.parse(Object.fromEntries(params))
  const where: Prisma.UserWhereInput = {
    role,
    isActive: active,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [data, total, activeAdmins] = await prisma.$transaction(
    [
      prisma.user.findMany({
        where,
        select,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      prisma.user.count({ where }),
      prisma.user.count({ where: { role: 'ADMIN', isActive: true } }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize), activeAdmins },
  }
}
export async function getAdminUser(id: string, request?: Request) {
  await authorize(request)
  const user = await prisma.user.findUnique({ where: { id }, select })
  if (!user) throw missing()
  return user
}
export async function createUser(input: unknown, request?: Request) {
  const actor = await authorize(request, true),
    data = UserCreateSchema.parse(input)
  const temporaryPassword = randomPassword(),
    passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const user = await transaction(actor, undefined, async (tx) => {
    const user = await tx.user.create({ data: { ...data, passwordHash, isActive: true } })
    await writeAudit(tx, {
      userId: actor.id,
      action: 'create',
      resource: 'user',
      resourceId: user.id,
      after: dto(user),
    })
    return dto(user)
  })
  return { user, temporaryPassword }
}
export async function updateUser(id: string, input: unknown, request?: Request) {
  const actor = await authorize(request, true),
    { revision, ...patch } = UserUpdateSchema.parse(input)
  return transaction(actor, id, async (tx, target) => {
    const before = target!
    if (before.revision !== revision) throw conflict()
    if (id === actor.id && (patch.isActive === false || (patch.role && patch.role !== 'ADMIN')))
      throw rule('不能停用或降级自己')
    if (
      before.isActive &&
      before.role === 'ADMIN' &&
      (patch.isActive === false || (patch.role && patch.role !== 'ADMIN')) &&
      (await tx.user.count({ where: { role: 'ADMIN', isActive: true } })) <= 1
    )
      throw rule('必须保留至少一位启用管理员')
    const updated = await tx.user.updateMany({
      where: { id, revision },
      data: { ...patch, revision: { increment: 1 } },
    })
    if (!updated.count) throw conflict()
    if (
      (patch.email !== undefined && patch.email !== before.email) ||
      (patch.role !== undefined && patch.role !== before.role) ||
      patch.isActive === false
    )
      await revoke(tx, id)
    const user = await tx.user.findUniqueOrThrow({ where: { id } })
    const keys = Object.keys(patch) as (keyof typeof patch)[]
    await writeAudit(tx, {
      userId: actor.id,
      action: 'update',
      resource: 'user',
      resourceId: id,
      before: Object.fromEntries(keys.map((key) => [key, before[key]])),
      after: Object.fromEntries(keys.map((key) => [key, user[key]])),
    })
    return dto(user)
  })
}
async function sensitiveOperation(
  id: string,
  input: unknown,
  request: Request | undefined,
  reset: boolean,
) {
  const actor = await authorize(request, true),
    { revision } = UserRevisionSchema.parse(input)
  if (id === actor.id) throw rule('本人请使用个人设置管理密码和会话')
  const temporaryPassword = reset ? randomPassword() : undefined
  const passwordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 12) : undefined
  const result = await transaction(actor, id, async (tx, target) => {
    if (target!.revision !== revision) throw conflict()
    const changed = await tx.user.updateMany({
      where: { id, revision },
      data: { ...(passwordHash ? { passwordHash } : {}), revision: { increment: 1 } },
    })
    if (!changed.count) throw conflict()
    const revoked = await revoke(tx, id)
    const user = await tx.user.findUniqueOrThrow({ where: { id } })
    await writeAudit(tx, {
      userId: actor.id,
      action: reset ? 'reset-password' : 'revoke-sessions',
      resource: 'user',
      resourceId: id,
      after: { revision: user.revision, revoked },
    })
    return { user: dto(user), revoked }
  })
  return { ...result, temporaryPassword }
}
export async function resetUserPassword(id: string, input: unknown, request?: Request) {
  const result = await sensitiveOperation(id, input, request, true)
  return { user: result.user, temporaryPassword: result.temporaryPassword! }
}
export async function revokeUserSessions(id: string, input: unknown, request?: Request) {
  const result = await sensitiveOperation(id, input, request, false)
  return { user: result.user, revoked: result.revoked }
}
