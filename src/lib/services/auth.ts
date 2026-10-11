import 'server-only'
import bcrypt from 'bcryptjs'
import { isIP } from 'node:net'
import type { Prisma, Session, User } from '@prisma/client'
import { cookies, headers } from 'next/headers'
import { prisma } from '../prisma'
import { env } from '../env'
import { ApiError } from '../api/errors'
import { can, PERMISSIONS, type Permission } from '../auth/rbac'
import {
  decryptReply,
  encryptReply,
  hashToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../auth/tokens'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'
export type RequestInfo = { ip?: string; userAgent?: string }
export type SessionUser = Pick<User, 'id' | 'name' | 'email' | 'avatar' | 'role'> & {
  permissions: Permission[]
  sessionId: string
}
export type Credentials = {
  user: SessionUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}
const safeUser = (user: User, sid: string): SessionUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  role: user.role,
  permissions: [...PERMISSIONS[user.role]],
  sessionId: sid,
})
const unauth = () => new ApiError(401, 'UNAUTHORIZED', '请重新登录')
const dummyHash = bcrypt.hashSync('dummy-password-for-timing', 12)
/** 所有会话变更先锁用户，再锁/修改会话，避免撤销遗漏与反向锁死锁。 */
async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const users = await tx.$queryRaw<User[]>`SELECT * FROM users WHERE id=${userId} FOR UPDATE`
  const user = users[0]
  if (!user) throw unauth()
  return user
}
/** 已认证请求等待用户锁期间可能发生合法轮转，沿同一会话族解析有效后继。 */
async function currentSession(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  let session = await tx.session.findUnique({ where: { id: sessionId } })
  const seen = new Set<string>()
  while (session && session.userId === userId && !seen.has(session.id)) {
    seen.add(session.id)
    if (!session.revokedAt && session.expiresAt > new Date()) return session
    if (
      !session.rotatedAt ||
      Date.now() - session.rotatedAt.getTime() > 10000 ||
      !session.successorId
    )
      break
    session = await tx.session.findUnique({ where: { id: session.successorId } })
  }
  throw unauth()
}
/** 撤销选定会话及其后继，覆盖撤销前刚完成的轮转。 */
async function revokeFamily(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  let id: string | null = sessionId
  const seen = new Set<string>()
  let count = 0
  while (id && !seen.has(id)) {
    seen.add(id)
    const session: Session | null = await tx.session.findUnique({ where: { id } })
    if (!session || session.userId !== userId) break
    await tx.session.update({ where: { id }, data: { revokedAt: new Date(), rotationReply: null } })
    count++
    id = session.successorId
  }
  return count
}
export function readCookie(request: Request, name: string) {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
/** 仅可信代理部署允许读取转发地址；默认不信任客户端声明的IP。 */
export function requestInfo(request: Request): RequestInfo {
  const forwarded =
    process.env.TRUST_PROXY === 'true'
      ? (request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        request.headers.get('x-real-ip')?.trim())
      : undefined
  return {
    ip: forwarded && isIP(forwarded) ? forwarded : 'unknown',
    userAgent: request.headers.get('user-agent')?.slice(0, 512),
  }
}
/** 写入口使用站点Origin核验；RSC/Action从当前请求头读取。 */
export async function assertOrigin(request?: Request) {
  const origin = request ? request.headers.get('origin') : (await headers()).get('origin')
  if (origin !== new URL(env.NEXT_PUBLIC_SITE_URL).origin)
    throw new ApiError(403, 'INVALID_ORIGIN', '请求来源不合法')
}
/** 邮箱/IP双维限流，密码核对后创建七天会话与脱敏审计。 */
export async function login(
  email: string,
  password: string,
  info: RequestInfo = {},
  request?: Request,
): Promise<Credentials> {
  await assertOrigin(request)
  const normalized = email.trim().toLowerCase()
  await Promise.all([
    consumeRateLimit(`login:ip:${info.ip ?? 'unknown'}`, 5, 900000),
    consumeRateLimit(`login:email:${normalized}`, 5, 900000),
  ])
  const user = await prisma.user.findUnique({ where: { email: normalized } })
  const matched = await bcrypt.compare(password, user?.passwordHash ?? dummyHash)
  if (!user || !matched) throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
  if (!user.isActive) throw new ApiError(403, 'ACCOUNT_DISABLED', '账号已停用')
  const refreshToken = newRefreshToken()
  return prisma.$transaction(async (tx) => {
    const current = await lockUser(tx, user.id)
    if (!current.isActive) throw new ApiError(403, 'ACCOUNT_DISABLED', '账号已停用')
    // 邮箱或密码在等待锁期间变更时，不复用事务外的旧认证结果。
    if (current.email !== normalized || current.passwordHash !== user.passwordHash)
      throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误')
    const session = await tx.session.create({
      data: {
        userId: user.id,
        refreshHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 604800000),
        ...info,
      },
    })
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await writeAudit(tx, {
      userId: user.id,
      action: 'login',
      resource: 'session',
      resourceId: session.id,
      ...info,
    })
    return {
      user: safeUser(current, session.id),
      accessToken: await signAccessToken(current, session.id),
      refreshToken,
      expiresIn: 900,
    }
  })
}
/** 锁旧会话实现原子轮转；重放撤销事务提交后再抛错。 */
export async function refresh(
  refreshToken: string,
  info: RequestInfo = {},
  request?: Request,
): Promise<Credentials> {
  await assertOrigin(request)
  await consumeRateLimit(`refresh:ip:${info.ip ?? 'unknown'}`, 30, 900000)
  const source = await prisma.session.findUnique({
    where: { refreshHash: hashToken(refreshToken) },
    select: { userId: true },
  })
  if (!source) throw unauth()
  const result = await prisma.$transaction(
    async (tx) => {
      const user = await lockUser(tx, source.userId)
      if (!user.isActive) return { error: unauth() }
      const rows = await tx.$queryRaw<
        Session[]
      >`SELECT * FROM sessions WHERE "refreshHash"=${hashToken(refreshToken)} FOR UPDATE`
      const old = rows[0]
      if (!old) return { error: unauth() }
      if (old.userId !== user.id) return { error: unauth() }
      if (old.rotatedAt) {
        const successor = old.successorId
          ? await tx.session.findUnique({ where: { id: old.successorId } })
          : null
        if (
          Date.now() - old.rotatedAt.getTime() <= 10000 &&
          old.rotationReply &&
          successor &&
          !successor.revokedAt &&
          successor.expiresAt > new Date()
        ) {
          return { credentials: decryptReply<Credentials>(old.rotationReply) }
        }
        // 宽限内后继失效仅要求重登，不能误判为超时重放。
        if (Date.now() - old.rotatedAt.getTime() <= 10000) return { error: unauth() }
        await tx.session.updateMany({
          where: { userId: user.id },
          data: { revokedAt: new Date(), rotationReply: null },
        })
        await writeAudit(tx, {
          userId: user.id,
          action: 'token-reused',
          resource: 'session',
          resourceId: old.id,
          ...info,
        })
        return { error: new ApiError(401, 'TOKEN_REUSED', '会话已失效，请重新登录') }
      }
      if (old.revokedAt || old.expiresAt <= new Date()) return { error: unauth() }
      const nextToken = newRefreshToken()
      const next = await tx.session.create({
        data: {
          userId: user.id,
          refreshHash: hashToken(nextToken),
          expiresAt: new Date(Date.now() + 604800000),
          rotatedFrom: old.id,
          ...info,
        },
      })
      const credentials: Credentials = {
        user: safeUser(user, next.id),
        accessToken: await signAccessToken(user, next.id),
        refreshToken: nextToken,
        expiresIn: 900,
      }
      await tx.session.update({
        where: { id: old.id },
        data: {
          revokedAt: new Date(),
          rotatedAt: new Date(),
          successorId: next.id,
          rotationReply: encryptReply(credentials),
        },
      })
      await tx.session.updateMany({
        where: {
          userId: user.id,
          rotatedAt: { lt: new Date(Date.now() - 10000) },
          rotationReply: { not: null },
        },
        data: { rotationReply: null },
      })
      return { credentials }
    },
    { timeout: 15000 },
  )
  if (result.error) throw result.error
  return result.credentials!
}
/** JWT只确定身份与sid；启用状态、会话与角色始终查询数据库。 */
export async function getSessionUser(request?: Request): Promise<SessionUser> {
  const token = request
    ? (request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] ??
      readCookie(request, 'at'))
    : (await cookies()).get('at')?.value
  if (!token) throw unauth()
  let payload
  try {
    payload = await verifyAccessToken(token)
  } catch {
    throw unauth()
  }
  if (typeof payload.sid !== 'string' || !payload.sub) throw unauth()
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  })
  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !session.user.isActive
  )
    throw unauth()
  return safeUser(session.user, session.id)
}
/** 数据入口统一授权，写操作额外验证Origin并共享限流。 */
export async function requirePermission(permission: Permission, request?: Request) {
  const user = await getSessionUser(request)
  if (
    !permission.endsWith(':read') ||
    (request && !['GET', 'HEAD', 'OPTIONS'].includes(request.method))
  )
    await assertOrigin(request)
  if (!can(user.role, permission)) throw new ApiError(403, 'FORBIDDEN', '没有操作权限')
  if (!permission.endsWith(':read')) await consumeRateLimit(`adminwrite:${user.id}`, 120, 900000)
  return user
}
/** 撤销当前会话，使尚未过期的AT立即失效。 */
export async function logout(request?: Request) {
  await assertOrigin(request)
  const user = await getSessionUser(request)
  await consumeRateLimit(`authwrite:${user.id}`, 120, 900000)
  await prisma.$transaction(async (tx) => {
    const current = await lockUser(tx, user.id)
    if (!current.isActive) throw unauth()
    await currentSession(tx, user.id, user.sessionId)
    await revokeFamily(tx, user.id, user.sessionId)
    await writeAudit(tx, {
      userId: user.id,
      action: 'logout',
      resource: 'session',
      resourceId: user.sessionId,
    })
  })
}
/** 全设备登出与审计在同一事务完成。 */
export async function logoutAll(request?: Request) {
  await assertOrigin(request)
  const user = await getSessionUser(request)
  await consumeRateLimit(`authwrite:${user.id}`, 120, 900000)
  await prisma.$transaction(async (tx) => {
    const current = await lockUser(tx, user.id)
    if (!current.isActive) throw unauth()
    await currentSession(tx, user.id, user.sessionId)
    await tx.session.updateMany({
      where: { userId: user.id },
      data: { revokedAt: new Date(), rotationReply: null },
    })
    await writeAudit(tx, { userId: user.id, action: 'logout-all', resource: 'session' })
  })
}
/** 仅返回本人有效会话的设备信息，不暴露令牌摘要。 */
export async function listSessions(request?: Request) {
  const user = await getSessionUser(request)
  return prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  })
}
/** 仅能撤销本人会话，跨用户标识不泄露存在性。 */
export async function revokeSession(id: string, request?: Request) {
  await assertOrigin(request)
  const user = await getSessionUser(request)
  await consumeRateLimit(`authwrite:${user.id}`, 120, 900000)
  await prisma.$transaction(async (tx) => {
    const current = await lockUser(tx, user.id)
    if (!current.isActive) throw unauth()
    await currentSession(tx, user.id, user.sessionId)
    if (!(await revokeFamily(tx, user.id, id))) throw new ApiError(404, 'NOT_FOUND', '会话不存在')
    await writeAudit(tx, { userId: user.id, action: 'revoke', resource: 'session', resourceId: id })
  })
}
/** 核验旧密码并撤销其他设备，保留当前会话。 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  request?: Request,
) {
  await assertOrigin(request)
  const user = await getSessionUser(request)
  await consumeRateLimit(`authwrite:${user.id}`, 120, 900000)
  if (
    newPassword.length < 8 ||
    !/[a-z]/.test(newPassword) ||
    !/[A-Z]/.test(newPassword) ||
    !/\d/.test(newPassword) ||
    currentPassword === newPassword
  )
    throw new ApiError(422, 'VALIDATION_ERROR', '密码至少8位，包含大小写字母与数字，且不同于旧密码')
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!(await bcrypt.compare(currentPassword, record.passwordHash)))
    throw new ApiError(401, 'INVALID_CREDENTIALS', '当前密码错误')
  if (await bcrypt.compare(newPassword, record.passwordHash))
    throw new ApiError(422, 'VALIDATION_ERROR', '新密码不能与旧密码相同')
  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.$transaction(async (tx) => {
    const current = await lockUser(tx, user.id)
    if (!current.isActive) throw unauth()
    const session = await currentSession(tx, user.id, user.sessionId)
    // 比较原摘要避免并发修改覆盖已生效的新密码。
    const changed = await tx.user.updateMany({
      where: { id: user.id, passwordHash: record.passwordHash, isActive: true },
      data: { passwordHash, revision: { increment: 1 } },
    })
    if (!changed.count) throw new ApiError(401, 'INVALID_CREDENTIALS', '密码已变更，请重新核验')
    await tx.session.updateMany({
      where: { userId: user.id, id: { not: session.id } },
      data: { revokedAt: new Date(), rotationReply: null },
    })
    await writeAudit(tx, {
      userId: user.id,
      action: 'change-password',
      resource: 'user',
      resourceId: user.id,
    })
  })
}
