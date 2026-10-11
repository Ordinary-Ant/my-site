import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { prisma } from '@/lib/prisma'
import { signAccessToken } from '@/lib/auth/tokens'
import { exportData, previewImport, importData } from '@/lib/services/data'
import { GET } from '@/app/api/v1/admin/export/route'
import { POST } from '@/app/api/v1/admin/import/route'
import { createHmac } from 'node:crypto'
import { env } from '@/lib/env'
import { updateArticle } from '@/lib/services/article'
import { DataBundleSchema } from '@/lib/validators/data'
import { Prisma } from '@prisma/client'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DataBundle } from '@/lib/validators/data'
const backupPath = join(process.cwd(), '.test-backups', 'data-backend-test-backup.json')
function saveBackup(bundle: DataBundle) {
  mkdirSync(join(process.cwd(), '.test-backups'), { recursive: true })
  if (existsSync(backupPath)) throw Error('存在上次未清理的导入测试备份，先恢复后再执行')
  writeFileSync(backupPath, JSON.stringify(bundle), { encoding: 'utf8', flag: 'wx' })
}
let userId: string,
  token: string,
  categoryId: string,
  tagId: string,
  articleId: string,
  logId: string,
  projectId: string,
  timelineId: string
const req = (method = 'POST', body?: unknown, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/v1/admin/import', {
    method,
    headers: { authorization: 'Bearer ' + token, origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
beforeAll(async () => {
  const db = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`
  if (!db[0].current_database.endsWith('_test')) throw Error('仅测试库')
  const user = await prisma.user.create({
    data: {
      name: 'data-test',
      email: `data-${Date.now()}@example.com`,
      passwordHash: 'never-export-this-secret',
      role: 'ADMIN',
    },
  })
  userId = user.id
  const session = await prisma.session.create({
    data: { userId, refreshHash: 'data-' + Date.now(), expiresAt: new Date(Date.now() + 600000) },
  })
  token = await signAccessToken(user, session.id)
  categoryId = (
    await prisma.category.create({ data: { name: '导入测试', slug: 'data-test-' + Date.now() } })
  ).id
  tagId = (await prisma.tag.create({ data: { name: '导入测试', slug: 'data-test-' + Date.now() } }))
    .id
  articleId = (
    await prisma.article.create({
      data: {
        title: '数据原文',
        slug: 'data-test-' + Date.now(),
        content: '  # 原始 Markdown\n',
        categoryId,
        tags: { connect: { id: tagId } },
        authorId: userId,
        deletedAt: new Date(),
      },
    })
  ).id
  logId = (
    await prisma.log.create({
      data: {
        title: '导入日志',
        content: '日志正文',
        logDate: new Date('2024-02-29'),
        authorId: userId,
        status: 'ARCHIVED',
        tags: { connect: { id: tagId } },
      },
    })
  ).id
  projectId = (
    await prisma.project.create({
      data: {
        title: '导入作品',
        slug: 'data-project-' + Date.now(),
        description: '作品简介',
        status: 'PUBLISHED',
        publishedAt: new Date('2099-01-01'),
        links: { github: 'https://example.com' },
        tags: { connect: { id: tagId } },
      },
    })
  ).id
  timelineId = (
    await prisma.timelineItem.create({
      data: {
        title: '导入经历',
        type: 'WORK',
        startDate: new Date('2020-01-01'),
        startPrecision: 'YEAR',
        isCurrent: true,
      },
    })
  ).id
})
afterAll(async () => {
  await prisma.article.deleteMany({ where: { OR: [{ id: articleId }, { authorId: userId }] } })
  await prisma.log.deleteMany({ where: { authorId: userId } })
  await prisma.project.deleteMany({ where: { id: projectId } })
  await prisma.timelineItem.deleteMany({ where: { id: timelineId } })
  await prisma.category.deleteMany({ where: { id: categoryId } })
  await prisma.tag.deleteMany({ where: { id: tagId } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.rateLimit.deleteMany({ where: { key: 'adminwrite:' + userId } })
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})
test('export preserves raw deleted content and relations without credentials; GET has attachment', async () => {
  const b = await exportData(req('GET'))
  expect(JSON.stringify(b)).not.toMatch(/never-export-this-secret|refreshHash|passwordHash/)
  expect(b.data.articles.find((a) => a.id === articleId)).toMatchObject({
    content: '  # 原始 Markdown\n',
    categoryId,
    tagIds: [tagId],
  })
  const r = await GET(req('GET'))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-disposition')).toContain('attachment')
})
test('preview is read only and merge skips same slug, maps same taxonomy without overwrite', async () => {
  const b = await exportData(req('GET'))
  const count = await prisma.article.count()
  const p = await previewImport({ mode: 'merge', bundle: b }, req())
  expect(await prisma.article.count()).toBe(count)
  expect(p.skipped.articles).toBe(b.data.articles.length)
  const done = await importData({ mode: 'merge', bundle: b, token: p.token }, req())
  expect(done.skipped.articles).toBe(b.data.articles.length)
  expect(await prisma.article.count()).toBe(count)
})
test('changed state, mode, file and token all reject stale preview atomically', async () => {
  const b = await exportData(req('GET')),
    p = await previewImport({ mode: 'merge', bundle: b }, req())
  await expect(
    importData({ mode: 'replace', bundle: b, token: p.token, confirmation: '替换全部内容' }, req()),
  ).rejects.toMatchObject({ status: 409 })
  await expect(
    importData(
      {
        mode: 'merge',
        bundle: { ...b, exportedAt: new Date(Date.now() + 1000).toISOString() },
        token: p.token,
      },
      req(),
    ),
  ).rejects.toMatchObject({ status: 409 })
  await prisma.article.update({ where: { id: articleId }, data: { revision: { increment: 1 } } })
  await expect(
    importData({ mode: 'merge', bundle: b, token: p.token }, req()),
  ).rejects.toMatchObject({ status: 409 })
  expect((await POST(req('POST', { mode: 'merge', bundle: b, token: 'bad' }))).status).toBe(409)
})
test('Origin, invalid relation and unknown business keys reject before changes', async () => {
  const b = await exportData(req('GET'))
  expect(
    (await POST(req('POST', { mode: 'merge', bundle: b, token: 'x' }, 'https://evil.test'))).status,
  ).toBe(403)
  const a = b.data.articles.find((a) => a.id === articleId)!
  a.categoryId = 'cmissing000000000000000000'
  await expect(previewImport({ mode: 'merge', bundle: b }, req())).rejects.toThrow()
})
test('full original export replaces atomically with raw text, stats, precision, config and relations; restores pre-test revisions', async () => {
  const bundle = await exportData(req('GET'))
  const previews = await prisma.previewToken.findMany()
  saveBackup(bundle)
  const beforeAudit = await prisma.auditLog.count({ where: { userId, resource: 'data' } })
  try {
    const p = await previewImport({ mode: 'replace', bundle }, req())
    await expect(
      importData({ mode: 'replace', bundle, token: p.token, confirmation: '错误' }, req()),
    ).rejects.toThrow()
    const result = await importData(
      { mode: 'replace', bundle, token: p.token, confirmation: '替换全部内容' },
      req(),
    )
    expect(result.created.articles).toBe(bundle.data.articles.length)
    const next = await exportData(req('GET'))
    expect(next.data.logs.find((v) => v.id === logId)?.logDate).toBe('2024-02-29')
    for (const key of [
      'categories',
      'tags',
      'articles',
      'logs',
      'projects',
      'timelineItems',
    ] as const) {
      expect(next.data[key].map((row) => row.id)).toEqual(bundle.data[key].map((row) => row.id))
      for (const row of next.data[key]) {
        const old = bundle.data[key].find((v) => v.id === row.id)!
        expect(row.revision).toBeGreaterThan(old.revision)
        expect({ ...row, revision: old.revision }).toEqual(old)
      }
    }
    expect(next.data.modules).toEqual(bundle.data.modules)
    expect(next.data.settings).toEqual(bundle.data.settings)
    expect(next.data.routeAliases).toEqual(bundle.data.routeAliases)
    expect(await prisma.auditLog.count({ where: { userId, resource: 'data' } })).toBe(
      beforeAudit + 1,
    )
  } finally {
    // 同ID原包替换仅提升revision；精确恢复原revision/updatedAt，避免污染其他验收fixture。
    for (const key of [
      'categories',
      'tags',
      'articles',
      'logs',
      'projects',
      'timelineItems',
    ] as const)
      for (const row of bundle.data[key]) {
        const model = {
          categories: prisma.category,
          tags: prisma.tag,
          articles: prisma.article,
          logs: prisma.log,
          projects: prisma.project,
          timelineItems: prisma.timelineItem,
        }[key] as unknown as { update(args: unknown): Promise<unknown> }
        await model.update({
          where: { id: row.id },
          data: {
            revision: row.revision,
            ...('updatedAt' in row ? { updatedAt: new Date(row.updatedAt) } : {}),
          },
        })
      }
    if (bundle.data.profile)
      await prisma.profile.update({
        where: { id: 'default' },
        data: {
          revision: bundle.data.profile.revision,
          updatedAt: new Date(bundle.data.profile.updatedAt),
        },
      })
    await prisma.previewToken.deleteMany()
    if (previews.length) await prisma.previewToken.createMany({ data: previews })
  }
  expect((await exportData(req('GET'))).data).toEqual(bundle.data)
  unlinkSync(backupPath)
})
test('expired HMAC preview and disabled/revoked/role/rate limits are rejected', async () => {
  const bundle = await exportData(req('GET')),
    p = await previewImport({ mode: 'merge', bundle }, req())
  const payload = JSON.parse(Buffer.from(p.token.split('.')[0], 'base64url').toString())
  payload.exp = Date.now() - 1
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'),
    sig = createHmac('sha256', env.JWT_SECRET)
      .update('data-import-preview:v1:' + encoded)
      .digest('base64url')
  await expect(
    importData({ mode: 'merge', bundle, token: encoded + '.' + sig }, req()),
  ).rejects.toMatchObject({ status: 409 })
  for (const role of ['EDITOR', 'VIEWER'] as const) {
    await prisma.user.update({ where: { id: userId }, data: { role } })
    expect((await GET(req('GET'))).status).toBe(403)
  }
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: false } })
  expect((await GET(req('GET'))).status).toBe(401)
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
  await prisma.rateLimit.upsert({
    where: { key: 'adminwrite:' + userId },
    create: { key: 'adminwrite:' + userId, count: 120, expiresAt: new Date(Date.now() + 600000) },
    update: { count: 120, expiresAt: new Date(Date.now() + 600000) },
  })
  expect((await GET(req('GET'))).status).toBe(429)
  await prisma.rateLimit.delete({ where: { key: 'adminwrite:' + userId } })
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
  expect((await GET(req('GET'))).status).toBe(401)
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: null } })
})
test('database audit failure rolls back the entire replacement including relations and revisions', async () => {
  const bundle = await exportData(req('GET')),
    p = await previewImport({ mode: 'replace', bundle }, req())
  const audit = await prisma.auditLog.count({ where: { resource: 'data', userId } })
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION data_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced data audit failure'; END $$`,
  )
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER data_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.resource='data') EXECUTE FUNCTION data_test_audit_failure()`,
  )
  try {
    await expect(
      importData({ mode: 'replace', bundle, token: p.token, confirmation: '替换全部内容' }, req()),
    ).rejects.toThrow()
    expect((await exportData(req('GET'))).data).toEqual(bundle.data)
    expect(await prisma.auditLog.count({ where: { resource: 'data', userId } })).toBe(audit)
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER data_test_audit_failure ON audit_logs')
    await prisma.$executeRawUnsafe('DROP FUNCTION data_test_audit_failure()')
  }
})
test('strict DTO rejects duplicates, calendar overflow, dangerous nested keys, hierarchy and unknown metadata', async () => {
  const original = await exportData(req('GET'))
  const mutations = [
    (b: typeof original) => {
      Reflect.deleteProperty(b.data.articles[0], 'status')
    },
    (b: typeof original) => b.data.articles.push(b.data.articles[0]),
    (b: typeof original) => {
      b.data.logs[0].logDate = '2023-02-29'
    },
    (b: typeof original) => {
      b.data.articles[0].createdAt = '2023-02-29T00:00:00.000Z'
    },
    (b: typeof original) => {
      Object.assign(b.data.articles[0], { passwordHash: 'forbidden' })
    },
    (b: typeof original) => {
      b.data.modules[0].config = JSON.parse('{"constructor":{"x":true}}')
    },
    (b: typeof original) => {
      b.data.categories.find((c) => c.id === categoryId)!.parentId = categoryId
    },
    (b: typeof original) => {
      b.data.modules.find((m) => m.key === 'home')!.enabled = false
    },
  ]
  for (const mutate of mutations) {
    const bundle = structuredClone(original)
    mutate(bundle)
    expect(DataBundleSchema.safeParse(bundle).success).toBe(false)
  }
})
test('merge reallocates colliding IDs, maps missing authors and relations, keeps existing fields', async () => {
  const bundle = await exportData(req('GET'))
  bundle.data.categories.find((c) => c.id === categoryId)!.slug += '-new'
  bundle.data.tags.find((t) => t.id === tagId)!.slug += '-new'
  const article = bundle.data.articles.find((a) => a.id === articleId)!
  article.slug += '-new'
  article.authorId = 'cmissing000000000000000000'
  const preview = await previewImport({ mode: 'merge', bundle }, req())
  const newCategory = preview.mapped.categories.find((m) => m.from === categoryId)!.to,
    newTag = preview.mapped.tags.find((m) => m.from === tagId)!.to,
    newArticle = preview.mapped.articles.find((m) => m.from === articleId)!.to
  try {
    const done = await importData({ mode: 'merge', bundle, token: preview.token }, req())
    expect(done.warnings.some((w) => w.includes('作者不存在'))).toBe(true)
    expect(
      await prisma.article.findUnique({ where: { id: newArticle }, include: { tags: true } }),
    ).toMatchObject({
      categoryId: newCategory,
      authorId: userId,
      tags: [{ id: newTag }],
      content: '  # 原始 Markdown\n',
    })
    expect((await prisma.article.findUnique({ where: { id: articleId } }))!.slug).not.toBe(
      article.slug,
    )
  } finally {
    await prisma.article.deleteMany({ where: { id: newArticle } })
    await prisma.category.deleteMany({ where: { id: newCategory } })
    await prisma.tag.deleteMany({ where: { id: newTag } })
  }
})
test('concurrent replace and editor cannot both silently overwrite an old revision', async () => {
  const bundle = await exportData(req('GET'))
  const article = bundle.data.articles.find((a) => a.id === articleId)!
  saveBackup(bundle)
  // 被软删原文不走编辑入口；选用独立可编辑fixture。
  const editable = await prisma.article.create({
    data: {
      title: '并发',
      slug: 'data-concurrency-' + Date.now(),
      content: '原文',
      authorId: userId,
    },
  })
  try {
    const current = await exportData(req('GET')),
      p = await previewImport({ mode: 'replace', bundle: current }, req())
    const outcomes = await Promise.allSettled([
      importData(
        { mode: 'replace', bundle: current, token: p.token, confirmation: '替换全部内容' },
        req(),
      ),
      updateArticle(editable.id, { revision: editable.revision, title: '并发编辑' }, req('PATCH')),
    ])
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  } finally {
    await prisma.article.deleteMany({ where: { id: editable.id } })
    for (const key of [
      'categories',
      'tags',
      'articles',
      'logs',
      'projects',
      'timelineItems',
    ] as const)
      for (const row of bundle.data[key]) {
        const model = {
          categories: prisma.category,
          tags: prisma.tag,
          articles: prisma.article,
          logs: prisma.log,
          projects: prisma.project,
          timelineItems: prisma.timelineItem,
        }[key] as unknown as { update(args: unknown): Promise<unknown> }
        await model.update({
          where: { id: row.id },
          data: {
            revision: row.revision,
            ...('updatedAt' in row ? { updatedAt: new Date(row.updatedAt) } : {}),
          },
        })
      }
    if (bundle.data.profile)
      await prisma.profile.update({
        where: { id: 'default' },
        data: {
          revision: bundle.data.profile.revision,
          updatedAt: new Date(bundle.data.profile.updatedAt),
        },
      })
  }
  expect((await prisma.article.findUnique({ where: { id: articleId } }))!.content).toBe(
    article.content,
  )
  expect((await exportData(req('GET'))).data).toEqual(bundle.data)
  unlinkSync(backupPath)
})
test('replace applies validated singleton config and preserves old plus imported history; preview tokens revoked', async () => {
  const original = await exportData(req('GET')),
    bundle = structuredClone(original)
  saveBackup(original)
  const previews = await prisma.previewToken.findMany()
  const path = '/data-import-history-' + Date.now(),
    articleModule = bundle.data.modules.find((m) => m.key === 'article')!,
    oldRoute = articleModule.route
  articleModule.route = '/data-import-route-' + Date.now()
  articleModule.config = { ...articleModule.config, pageSize: 7 }
  bundle.data.routeAliases.push({ path, moduleKey: 'article', createdAt: new Date().toISOString() })
  if (bundle.data.profile) {
    bundle.data.profile.company = '恢复配置'
    bundle.data.profile.contactVisible = false
  }
  const setting = bundle.data.settings.find((s) => s.key === 'site.name')
  if (setting) setting.value = '恢复站点配置'
  await prisma.previewToken.create({
    data: {
      hash: 'data-test-' + Date.now(),
      kind: 'article',
      contentId: articleId,
      expiresAt: new Date(Date.now() + 60000),
    },
  })
  try {
    const p = await previewImport({ mode: 'replace', bundle }, req())
    await importData(
      { mode: 'replace', bundle, token: p.token, confirmation: '替换全部内容' },
      req(),
    )
    expect(await prisma.routeAlias.findUnique({ where: { path: oldRoute } })).toMatchObject({
      moduleKey: 'article',
    })
    expect(await prisma.routeAlias.findUnique({ where: { path } })).toMatchObject({
      moduleKey: 'article',
    })
    expect(await prisma.module.findUnique({ where: { key: 'article' } })).toMatchObject({
      route: articleModule.route,
      config: { pageSize: 7 },
    })
    expect(
      await prisma.previewToken.count({ where: { kind: 'article', contentId: articleId } }),
    ).toBe(0)
    if (bundle.data.profile)
      expect(await prisma.profile.findUnique({ where: { id: 'default' } })).toMatchObject({
        company: '恢复配置',
        contactVisible: false,
      })
    if (setting)
      expect(await prisma.setting.findUnique({ where: { key: 'site.name' } })).toMatchObject({
        value: '恢复站点配置',
      })
    await expect(
      updateArticle(
        articleId,
        {
          revision: original.data.articles.find((a) => a.id === articleId)!.revision,
          title: '旧稿',
        },
        req('PATCH'),
      ),
    ).rejects.toThrow()
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.routeAlias.deleteMany()
      for (const m of original.data.modules)
        await tx.module.update({
          where: { key: m.key },
          data: {
            ...m,
            updatedAt: new Date(m.updatedAt),
            config: m.config === null ? Prisma.JsonNull : (m.config as Prisma.InputJsonValue),
          },
        })
      for (const a of original.data.routeAliases)
        await tx.routeAlias.create({ data: { ...a, createdAt: new Date(a.createdAt) } })
      for (const s of original.data.settings)
        await tx.setting.update({
          where: { key: s.key },
          data: {
            ...s,
            value: s.value === null ? Prisma.JsonNull : (s.value as Prisma.InputJsonValue),
            updatedAt: new Date(s.updatedAt),
          },
        })
      for (const key of [
        'categories',
        'tags',
        'articles',
        'logs',
        'projects',
        'timelineItems',
      ] as const)
        for (const row of original.data[key]) {
          const model = {
            categories: tx.category,
            tags: tx.tag,
            articles: tx.article,
            logs: tx.log,
            projects: tx.project,
            timelineItems: tx.timelineItem,
          }[key] as unknown as { update(args: unknown): Promise<unknown> }
          await model.update({
            where: { id: row.id },
            data: {
              revision: row.revision,
              ...('updatedAt' in row ? { updatedAt: new Date(row.updatedAt) } : {}),
            },
          })
        }
      if (original.data.profile) {
        const p = original.data.profile
        await tx.profile.update({
          where: { id: 'default' },
          data: {
            ...p,
            birthday: p.birthday ? new Date(p.birthday) : null,
            updatedAt: new Date(p.updatedAt),
          },
        })
      }
      await tx.previewToken.deleteMany()
      if (previews.length) await tx.previewToken.createMany({ data: previews })
    })
  }
  expect((await exportData(req('GET'))).data).toEqual(original.data)
  unlinkSync(backupPath)
})
test('payload byte/entity caps and deeply nested JSON return bounded errors', async () => {
  const bundle = await exportData(req('GET'))
  await expect(
    previewImport({ mode: 'merge', bundle: { ...bundle, padding: 'x'.repeat(4_000_001) } }, req()),
  ).rejects.toMatchObject({ status: 413 })
  const many = structuredClone(bundle)
  many.data.tags = Array.from({ length: 5001 }, (_, i) => ({
    ...bundle.data.tags[0],
    id: 'c' + String(i).padStart(24, '0'),
    slug: 'size-' + i,
  }))
  many.data.articles = []
  many.data.logs = []
  many.data.projects = []
  await expect(previewImport({ mode: 'merge', bundle: many }, req())).rejects.toMatchObject({
    status: 413,
  })
  let deep: unknown = {}
  for (let n = 0; n < 1000; n++) deep = { nested: deep }
  await expect(
    previewImport({ mode: 'merge', bundle: { ...bundle, deep } }, req()),
  ).rejects.toMatchObject({ status: 400 })
})
test('preview refuses noncanonical timeline dates and incomplete motion without changing real data', async () => {
  const original = await exportData(req('GET'))
  for (const startDate of [
    '0000-01-01T00:00:00.000Z',
    '9999-01-01T00:00:00.000Z',
    '2020-12-31T12:00:00.000Z',
    '2020-01-02T00:00:00.000Z',
    '2020-01-01T00:00:00+08:00',
  ]) {
    const bundle = structuredClone(original)
    Object.assign(
      bundle.data.timelineItems.find((t) => t.id === timelineId)!,
      { startDate, startPrecision: 'YEAR' },
    )
    expect(
      await previewImport({ mode: 'replace', bundle }, req()).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  }
  for (const key of ['intensity', 'mobileIntensity']) {
    const bundle = structuredClone(original)
    Reflect.deleteProperty(
      bundle.data.settings.find((s) => s.key === 'motion.config')!.value as object,
      key,
    )
    expect(
      await previewImport({ mode: 'replace', bundle }, req()).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  }
  expect((await exportData(req('GET'))).data).toEqual(original.data)
  expect(
    (await previewImport({ mode: 'replace', bundle: original }, req())).created.timelineItems,
  ).toBe(original.data.timelineItems.length)
})
test('birthday import preview rejects UTC day shifts and out-of-range storage dates without mutations', async () => {
  const original = await exportData(req('GET'))
  expect(original.data.profile).not.toBeNull()
  for (const birthday of [
    '2020-01-01T00:00:00+08:00',
    '9998-12-31T23:00:00-02:00',
    '2020-01-01T12:00:00.000Z',
  ]) {
    const bundle = structuredClone(original)
    bundle.data.profile!.birthday = birthday
    expect(
      await previewImport({ mode: 'replace', bundle }, req()).then(
        () => true,
        () => false,
      ),
      birthday,
    ).toBe(false)
  }
  for (const birthday of [
    null,
    '0001-01-01T00:00:00.000Z',
    '2024-02-29T00:00:00.000Z',
    '9998-12-31T00:00:00.000Z',
  ]) {
    const bundle = structuredClone(original)
    bundle.data.profile!.birthday = birthday
    expect((await previewImport({ mode: 'replace', bundle }, req())).created.profile).toBe(1)
  }
  expect((await exportData(req('GET'))).data).toEqual(original.data)
})
