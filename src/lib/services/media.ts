import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma, Media } from '@prisma/client'
import { z } from 'zod'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { ApiError } from '@/lib/api/errors'
import { inspectMedia, mediaType } from '@/lib/storage/validation'
import { storageDriver, LocalDriver, R2Driver, assertLocalAllowed } from '@/lib/storage/drivers'
import { requirePermission } from './auth'
import { consumeRateLimit } from './rate-limit'
import { writeAudit } from './audit'

const fieldsSchema = z
  .object({
    alt: z.string().max(1000).nullable().optional(),
    folder: z
      .string()
      .max(200)
      .regex(/^\/(?:[\p{L}\p{N}_ -]+\/?)*$/u)
      .optional(),
  })
  .strict()
const intentSchema = fieldsSchema.extend({
  originalName: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
})
const missing = () => new ApiError(404, 'NOT_FOUND', '媒体不存在')
function originalName(name: string) {
  return name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255) || 'upload'
}
async function uploadUser(request?: Request) {
  const user = await requirePermission('media:write', request)
  await consumeRateLimit(`upload:${user.id}`, 20, 3600000)
  return user
}
/** 文件先校验，再写私有目录与DB；失败删除孤立对象。hash锁保证并发去重。 */
async function registerMedia(
  bytes: Buffer,
  input: { originalName: string; mimeType: string; alt?: string | null; folder?: string },
  userId: string,
  intentId?: string,
) {
  const inspected = await inspectMedia(bytes, input.mimeType)
  const id = randomUUID()
  const filename = `${randomUUID()}.${inspected.ext}`
  const key = `media/${filename}`
  const driver = storageDriver()
  // 补偿票据先独立提交；进程崩溃、DB回滚或删除故障仍能定位公开对象。
  const compensation = await prisma.uploadIntent.create({
    data: {
      userId,
      key,
      originalName: originalName(input.originalName),
      mimeType: inspected.mimeType,
      size: inspected.size,
      hash: inspected.hash,
      status: 'COMPENSATE',
      expiresAt: new Date(),
    },
  })
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inspected.hash}))`
        const existing = await tx.media.findUnique({ where: { hash: inspected.hash } })
        if (existing) {
          await tx.uploadIntent.delete({ where: { id: compensation.id } })
          if (intentId)
            await tx.uploadIntent.update({
              where: { id: intentId },
              data: { status: 'CONFIRMED', mediaId: existing.id },
            })
          await writeAudit(tx, {
            userId,
            action: 'deduplicate',
            resource: 'media',
            resourceId: existing.id,
          })
          return { ...existing, deduplicated: true }
        }
        await driver.put(key, bytes, inspected.mimeType)
        const { ext: _ext, ...metadata } = inspected
        const media = await tx.media.create({
          data: {
            id,
            ...metadata,
            filename,
            key,
            originalName: originalName(input.originalName),
            url: driver instanceof R2Driver ? driver.publicUrl(key) : `/api/v1/media/${id}`,
            alt: input.alt,
            folder: input.folder || '/',
            uploadedBy: userId,
          },
        })
        if (intentId)
          await tx.uploadIntent.update({
            where: { id: intentId },
            data: { status: 'CONFIRMED', mediaId: media.id },
          })
        await writeAudit(tx, {
          userId,
          action: 'upload',
          resource: 'media',
          resourceId: media.id,
          after: media,
        })
        await tx.uploadIntent.delete({ where: { id: compensation.id } })
        return { ...media, deduplicated: false }
      },
      { timeout: 60000 },
    )
  } catch (error) {
    try {
      await driver.remove(key)
      await prisma.uploadIntent.delete({ where: { id: compensation.id } })
    } catch {
      /* 持久补偿票据保留，cleanup继续重试。 */
    }
    throw error
  }
}
export async function uploadLocalMedia(file: File, fields: unknown, request?: Request) {
  const user = await uploadUser(request)
  if (env.STORAGE_DRIVER !== 'local')
    throw new ApiError(405, 'DIRECT_UPLOAD_REQUIRED', '请使用R2直传')
  assertLocalAllowed()
  const input = fieldsSchema.parse(fields)
  if (!(file instanceof File)) throw new ApiError(400, 'INVALID_FILE', '请选择文件')
  mediaType(file.type, file.size)
  return registerMedia(
    Buffer.from(await file.arrayBuffer()),
    { ...input, originalName: file.name, mimeType: file.type },
    user.id,
  )
}
export async function createUploadIntent(input: unknown, request?: Request) {
  const user = await uploadUser(request)
  if (env.STORAGE_DRIVER !== 's3')
    throw new ApiError(405, 'LOCAL_UPLOAD_REQUIRED', '本地使用multipart上传')
  const parsed = intentSchema.parse(input)
  mediaType(parsed.mimeType, parsed.size)
  const driver = new R2Driver()
  const key = `private/upload/${randomUUID()}`
  const intent = await prisma.uploadIntent.create({
    data: {
      ...parsed,
      originalName: originalName(parsed.originalName),
      userId: user.id,
      key,
      expiresAt: new Date(Date.now() + 600000),
    },
  })
  try {
    const credentials = await driver.intent(key, parsed.mimeType, parsed.size, parsed.hash)
    await writeAudit(prisma, {
      userId: user.id,
      action: 'upload-intent',
      resource: 'media',
      resourceId: intent.id,
    })
    return { intentId: intent.id, expiresAt: intent.expiresAt, ...credentials }
  } catch (error) {
    await prisma.uploadIntent.update({ where: { id: intent.id }, data: { status: 'FAILED' } })
    throw error
  }
}
export async function confirmMedia(input: unknown, request?: Request) {
  const user = await requirePermission('media:write', request)
  const { intentId } = z
    .object({ intentId: z.string().min(1) })
    .strict()
    .parse(input)
  if (env.STORAGE_DRIVER !== 's3')
    throw new ApiError(405, 'LOCAL_UPLOAD_REQUIRED', '本地使用multipart上传')
  const driver = new R2Driver()
  const intent = await prisma.uploadIntent.findFirst({ where: { id: intentId, userId: user.id } })
  if (!intent) throw missing()
  const claimed = await prisma.uploadIntent.updateMany({
    where: { id: intentId, userId: user.id, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: { status: 'PROCESSING' },
  })
  if (!claimed.count) throw new ApiError(409, 'UPLOAD_INTENT_INVALID', '上传票据已过期或已被消费')
  try {
    const bytes = await driver.get(intent.key, intent.size)
    const inspected = await inspectMedia(bytes, intent.mimeType)
    if (inspected.size !== intent.size || inspected.hash !== intent.hash)
      throw new ApiError(422, 'UPLOAD_MISMATCH', '文件大小或SHA256与票据不符')
    const result = await registerMedia(bytes, intent, user.id, intent.id)
    await driver.remove(intent.key).catch(() => undefined)
    return result
  } catch (error) {
    await prisma.uploadIntent.update({ where: { id: intent.id }, data: { status: 'FAILED' } })
    await driver.remove(intent.key).catch(() => undefined)
    throw error
  }
}
/** 超时票据保留key，清理失败可在下次任务重试。 */
export async function cleanupUploadIntents(request?: Request) {
  const user = await requirePermission('media:write', request)
  const driver = storageDriver()
  const where = { expiresAt: { lt: new Date(Date.now() - 3600000) } }
  const intents = await prisma.uploadIntent.findMany({
    where,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: 100,
  })
  let cleaned = 0
  let failed = 0
  for (const intent of intents) {
    try {
      await driver.remove(intent.key)
      await prisma.$transaction(async (tx) => {
        await tx.uploadIntent.delete({ where: { id: intent.id } })
        await writeAudit(tx, {
          userId: user.id,
          action: 'cleanup',
          resource: 'media',
          resourceId: intent.id,
          before: { key: intent.key, status: intent.status },
        })
      })
      cleaned++
    } catch (error) {
      failed++
      // 单项故障保留key并移到队尾；坏对象不能阻塞后续批次。
      try {
        await prisma.$transaction(async (tx) => {
          await tx.uploadIntent.update({
            where: { id: intent.id },
            data: { updatedAt: new Date() },
          })
          await writeAudit(tx, {
            userId: user.id,
            action: 'cleanup-failed',
            resource: 'media',
            resourceId: intent.id,
            after: { code: error instanceof ApiError ? error.code : 'STORAGE_CLEANUP_FAILED' },
          })
        })
      } catch {
        /* DB故障时票据仍在，继续处理其他项并保留最终汇总。 */
      }
    }
  }
  const result = { cleaned, failed, pending: await prisma.uploadIntent.count({ where }) }
  await writeAudit(prisma, {
    userId: user.id,
    action: 'cleanup-summary',
    resource: 'media',
    after: result,
  })
  return result
}
export async function listMedia(params: URLSearchParams, request?: Request) {
  await requirePermission('content:read', request)
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get('page')) || 1)))
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(params.get('pageSize')) || 20)))
  const kind = z
    .enum(['IMAGE', 'VIDEO', 'DOCUMENT'])
    .optional()
    .parse(params.get('kind') || undefined)
  const where: Prisma.MediaWhereInput = {
    ...(params.get('folder') ? { folder: params.get('folder')! } : {}),
    ...(kind ? { kind } : {}),
    ...(params.get('q')
      ? { originalName: { contains: params.get('q')!.slice(0, 200), mode: 'insensitive' } }
      : {}),
  }
  const [data, total] = await prisma.$transaction([
    prisma.media.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.media.count({ where }),
  ])
  return {
    data,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
      hasPrev: page > 1,
    },
  }
}
export async function getMedia(id: string, request?: Request) {
  await requirePermission('content:read', request)
  const media = await prisma.media.findUnique({ where: { id } })
  if (!media) throw missing()
  return media
}
export async function updateMedia(id: string, input: unknown, request?: Request) {
  const user = await requirePermission('media:write', request)
  const parsed = fieldsSchema.parse(input)
  return prisma.$transaction(async (tx) => {
    const before = await tx.media.findUnique({ where: { id } })
    if (!before) throw missing()
    const media = await tx.media.update({ where: { id }, data: parsed })
    await writeAudit(tx, {
      userId: user.id,
      action: 'update',
      resource: 'media',
      resourceId: id,
      before,
      after: media,
    })
    return media
  })
}
export type MediaReference = { type: string; id: string; title: string; field: string }
const referenceMarkdown = unified().use(remarkParse).use(remarkGfm)
type ReferenceNode = { type: string; url?: string; children?: ReferenceNode[] }
/** 仅解码URL中的ASCII字节；异常及UTF-8片段保留，不影响同文其他引用。 */
function normalizeReference(value: string): string {
  while (true) {
    // 同时折叠嵌套%25，避免长链双重编码逐层扫描。
    const decoded = value.replace(/%(?:25)*([0-7][0-9a-f])/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    if (decoded === value) return value
    value = decoded
  }
}
/** 包含软删内容及嵌套配置；保留数据的引用同样阻止删除。 */
async function references(db: Prisma.TransactionClient | typeof prisma, media: Media) {
  const result: MediaReference[] = []
  const needles = [
    media.url,
    new URL(media.url, env.NEXT_PUBLIC_SITE_URL).pathname,
    media.id,
    media.key,
  ].map(normalizeReference)
  const contains = (value: unknown): boolean => {
    if (typeof value === 'string') {
      const matches = (target: string) => {
        const normalized = normalizeReference(target)
        return needles.some((n) => normalized.includes(n))
      }
      if (matches(value)) return true
      // 与阅读页一致地解析转义及实体；只比较目标URL，不能直接删除反斜杠。
      if (!/[\\&]/.test(value)) return false
      const visit = (node: ReferenceNode): boolean =>
        (['image', 'link', 'definition'].includes(node.type) &&
          typeof node.url === 'string' &&
          matches(node.url)) ||
        (node.children?.some(visit) ?? false)
      return visit(referenceMarkdown.parse(value))
    }
    return Array.isArray(value)
      ? value.some(contains)
      : value !== null && typeof value === 'object'
        ? Object.values(value).some(contains)
        : false
  }
  const groups = await Promise.all([
    db.article.findMany(),
    db.log.findMany(),
    db.project.findMany(),
    db.profile.findMany(),
    db.setting.findMany(),
    db.timelineItem.findMany(),
    db.module.findMany(),
    db.user.findMany({ select: { id: true, name: true, avatar: true } }),
  ])
  const types = ['article', 'log', 'project', 'profile', 'setting', 'timeline', 'module', 'user']
  groups.forEach((rows, index) =>
    rows.forEach((row) =>
      Object.entries(row).forEach(([field, value]) => {
        if (contains(value))
          result.push({
            type: types[index],
            id: 'id' in row ? String(row.id) : String((row as { key: string }).key),
            title:
              'title' in row ? String(row.title) : 'name' in row ? String(row.name) : types[index],
            field,
          })
      }),
    ),
  )
  return result
}
export async function mediaReferences(id: string, request?: Request) {
  const media = await getMedia(id, request)
  return references(prisma, media)
}
export async function deleteMedia(id: string, request?: Request) {
  const user = await requirePermission('media:write', request)
  const media = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`LOCK TABLE articles, logs, projects, profiles, settings, timeline_items, modules, users IN SHARE ROW EXCLUSIVE MODE`
      const item = await tx.media.findUnique({ where: { id } })
      if (!item) throw missing()
      if (item.hash) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${item.hash}))`
      const refs = await references(tx, item)
      if (refs.length)
        throw new ApiError(409, 'MEDIA_IN_USE', '媒体仍被内容引用，请先移除引用', refs)
      // DB删除与对象清理队列原子提交；存储故障不会丢失重试key。
      await tx.uploadIntent.create({
        data: {
          userId: user.id,
          key: item.key,
          originalName: item.originalName,
          mimeType: item.mimeType,
          size: item.size,
          hash: item.hash || '',
          status: 'DELETE',
          mediaId: item.id,
          expiresAt: new Date(0),
        },
      })
      await tx.media.delete({ where: { id } })
      await writeAudit(tx, {
        userId: user.id,
        action: 'delete',
        resource: 'media',
        resourceId: id,
        before: item,
      })
      return item
    },
    { timeout: 30000 },
  )
  try {
    await storageDriver().remove(media.key)
    await prisma.uploadIntent.delete({ where: { key: media.key } })
    return { id: media.id, cleanupPending: false }
  } catch {
    return { id: media.id, cleanupPending: true }
  }
}
export async function readLocalMedia(id: string) {
  if (env.STORAGE_DRIVER !== 'local') throw missing()
  const media = await prisma.media.findUnique({ where: { id } })
  if (!media) throw missing()
  try {
    return {
      media,
      bytes: await new LocalDriver().get(media.key, mediaType(media.mimeType, media.size).max),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missing()
    throw error
  }
}
