import { beforeAll, afterAll, expect, test, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { login } from '@/lib/services/auth'
import {
  createLog,
  updateLog,
  deleteLog,
  restoreLog,
  purgeLog,
  listPublicLogs,
  getPublicLog,
  getLogCalendar,
  bulkLogs,
  listAdminLogs,
  listAdminLogCalendar,
  createLogPreviewToken,
  getPreviewLog,
} from '@/lib/services/log'
let userId: string, token: string
const ids: string[] = []
let savedModule: unknown
const request = () =>
  new Request('http://localhost:3000/api/v1/admin/logs', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' },
  })
const make = async (extra: Record<string, unknown> = {}) => {
  const log = await createLog(
    { title: '日志验收', content: '正文', logDate: '2024-02-29', ...extra },
    request(),
  )
  ids.push(log.id)
  return log
}
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: '日志验收',
      email: `logs-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('TestPass123', 4),
      role: 'ADMIN',
    },
  })
  userId = user.id
  token = (await login(user.email, 'TestPass123', { ip: `logs-${user.id}` }, request())).accessToken
  savedModule = await prisma.module.findUnique({ where: { key: 'log' } })
  await prisma.module.upsert({
    where: { key: 'log' },
    update: {
      enabled: true,
      config: { types: { DAILY: true, EVENT: true, SUMMARY: true }, pageSize: 3 },
    },
    create: { key: 'log', name: '日志', route: '/logs' },
  })
})
afterAll(async () => {
  await prisma.previewToken.deleteMany({ where: { contentId: { in: ids }, kind: 'log' } })
  await prisma.log.deleteMany({ where: { id: { in: ids } } })
  await prisma.auditLog.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })
  const old = savedModule as { enabled: boolean; config: object }
  if (old)
    await prisma.module.update({
      where: { key: 'log' },
      data: { enabled: old.enabled, config: old.config },
    })
  await prisma.$disconnect()
})
test('真实日期、默认发布、分页无正文、筛选与日历一致', async () => {
  const log = await make({ title: '日历唯一检索', mood: 'happy' })
  expect(log.logDate).toBe('2024-02-29')
  expect(log.publishedAt).toBeTruthy()
  expect(log.authorId).toBe(userId)
  const params = new URLSearchParams({ q: '日历唯一检索', year: '2024', month: '2', mood: 'happy' })
  const result = await listPublicLogs(params)
  expect(result.data.map((x) => x.id)).toContain(log.id)
  expect(result.data[0]).not.toHaveProperty('content')
  expect(result.meta.pageSize).toBe(3)
  expect(await getLogCalendar(params)).toEqual({
    year: 2024,
    months: [{ month: 2, count: 1, days: [29], dayCounts: { '29': 1 } }],
    total: 1,
  })
})
test('类型与模块、未来日期、置顶不能绕过发布状态', async () => {
  const future = await make({ logDate: '2099-01-01' })
  await expect(getPublicLog(future.id)).rejects.toMatchObject({ status: 404 })
  const pinned = await make({ logDate: '2099-01-01', isPinned: true })
  expect((await getPublicLog(pinned.id)).id).toBe(pinned.id)
  const scheduled = await make({ isPinned: true, publishedAt: '2099-01-01T00:00:00Z' })
  await expect(getPublicLog(scheduled.id)).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({
    where: { key: 'log' },
    data: { config: { types: { DAILY: false, EVENT: true, SUMMARY: true } } },
  })
  await expect(getPublicLog(pinned.id)).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({ where: { key: 'log' }, data: { enabled: false } })
  expect((await listPublicLogs()).data).toEqual([])
  expect((await getLogCalendar(new URLSearchParams({ year: '2024' }))).total).toBe(0)
  await prisma.module.update({
    where: { key: 'log' },
    data: {
      enabled: true,
      config: { types: { DAILY: true, EVENT: true, SUMMARY: true }, pageSize: 3 },
    },
  })
})
test('并发CAS、清除数组、软删恢复及管理员彻底删除', async () => {
  const log = await make({ images: ['/uploads/a.png'], mood: 'happy' })
  const results = await Promise.allSettled([
    updateLog(log.id, { revision: 1, title: '甲' }, request()),
    updateLog(log.id, { revision: 1, title: '乙' }, request()),
  ])
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  const updated = await updateLog(log.id, { revision: 2, mood: null, images: [] }, request())
  expect(updated.images).toEqual([])
  expect(updated.mood).toBeNull()
  await deleteLog(log.id, updated.revision, request())
  await expect(getPublicLog(log.id)).rejects.toMatchObject({ status: 404 })
  expect(
    (await listAdminLogs(new URLSearchParams({ includeDeleted: 'true' }), request())).data.map(
      (x) => x.id,
    ),
  ).toContain(log.id)
  const restored = await restoreLog(log.id, 4, request())
  expect(restored.revision).toBe(5)
  await deleteLog(log.id, 5, request())
  await expect(purgeLog(log.id, 5, request())).rejects.toMatchObject({ status: 409 })
  await purgeLog(log.id, 6, request())
  expect(await prisma.log.findUnique({ where: { id: log.id } })).toBeNull()
})
test('批量逐项CAS并审计，失败不回滚成功', async () => {
  const a = await make({ status: 'DRAFT' }),
    b = await make({ status: 'DRAFT' })
  const result = await bulkLogs(
    { ids: [a.id, b.id], revisions: { [a.id]: 1, [b.id]: 99 }, action: 'publish' },
    request(),
  )
  expect(result.succeeded).toEqual([a.id])
  expect(result.failed[0]).toMatchObject({ id: b.id, code: 'REVISION_CONFLICT' })
  expect(
    await prisma.auditLog.count({
      where: { resource: 'log', resourceId: a.id, action: 'publish' },
    }),
  ).toBe(1)
})

test('后台授权逐次核验角色、账号启用与AT会话', async () => {
  const log = await make()
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  expect((await listAdminLogs(new URLSearchParams(), request())).data.length).toBeGreaterThan(0)
  await expect(
    createLog({ title: '越权', content: '正文', logDate: '2024-01-01' }, request()),
  ).rejects.toMatchObject({ status: 403 })
  await expect(updateLog(log.id, { revision: 1, title: '越权' }, request())).rejects.toMatchObject({
    status: 403,
  })
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: false } })
  await expect(listAdminLogs(new URLSearchParams(), request())).rejects.toMatchObject({
    status: 401,
  })
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } })
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } })
  await expect(listAdminLogs(new URLSearchParams(), request())).rejects.toMatchObject({
    status: 401,
  })
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  token = (await login(user.email, 'TestPass123', { ip: `logs-relogin-${user.id}` }, request()))
    .accessToken
})
test('日历聚合多条同日记录及精确日期选择，邻接遵循公开过滤', async () => {
  const a = await make({ title: '同日测试', logDate: '2023-05-06' }),
    b = await make({ title: '同日测试', logDate: '2023-05-06' })
  await make({ title: '同日测试', logDate: '2023-05-07', status: 'DRAFT' })
  const params = new URLSearchParams({
    q: '同日测试',
    year: '2023',
    month: '5',
    date: '2023-05-06',
  })
  expect((await listPublicLogs(params)).meta.total).toBe(2)
  expect((await getLogCalendar(params)).months[0]).toMatchObject({
    count: 2,
    days: [6],
    dayCounts: { '6': 2 },
  })
  const detail = await getPublicLog(a.id)
  expect([detail.prev?.id, detail.next?.id]).toContain(b.id)
})
test('批量不存在标签记部分失败且事务不增加revision', async () => {
  const log = await make({ status: 'DRAFT' })
  const result = await bulkLogs(
    {
      ids: [log.id],
      revisions: { [log.id]: 1 },
      action: 'addTags',
      payload: { tagIds: ['cmissingtag000000000000000'] },
    },
    request(),
  )
  expect(result.failed).toEqual([expect.objectContaining({ id: log.id, code: 'NOT_FOUND' })])
  expect(result.succeeded).toEqual([])
  expect((await prisma.log.findUniqueOrThrow({ where: { id: log.id } })).revision).toBe(1)
})
test('单独月份默认上海当前年，后台安全排序与非法排序拒绝', async () => {
  const year = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 4))
  const a = await make({ title: '单独月份排序甲', logDate: `${year}-01-01` }),
    b = await make({ title: '单独月份排序乙', logDate: `${year}-02-01` })
  const january = await listPublicLogs(new URLSearchParams({ q: '单独月份排序', month: '1' }))
  expect(january.data.map((x) => x.id)).toEqual([a.id])
  const sorted = await listAdminLogs(
    new URLSearchParams({ q: '单独月份排序', sort: 'logDate:asc' }),
    request(),
  )
  expect(sorted.data.map((x) => x.id)).toEqual([a.id, b.id])
  await expect(
    listAdminLogs(new URLSearchParams({ sort: 'content:asc' }), request()),
  ).rejects.toMatchObject({ status: 400 })
  await expect(
    listAdminLogs(new URLSearchParams({ sort: 'logDate:wrong' }), request()),
  ).rejects.toMatchObject({ status: 400 })
  const publicSorted = await listPublicLogs(
    new URLSearchParams({ q: '单独月份排序', sort: 'logDate:asc' }),
  )
  expect(publicSorted.data.map((x) => x.id)).toEqual([b.id, a.id])
})
test('公开摘要固定120字且日期独立筛选列表日历一致', async () => {
  const log = await make({
    title: '摘要日期独立验收',
    summary: '长'.repeat(500),
    logDate: '2023-05-06',
  })
  const params = new URLSearchParams({ q: '摘要日期独立验收', date: '2023-05-06' })
  const list = await listPublicLogs(params)
  expect(list.data[0].id).toBe(log.id)
  expect(list.data[0].summary).toBe('长'.repeat(120))
  const calendar = await getLogCalendar(params)
  expect(calendar.year).toBe(2023)
  expect(calendar.total).toBe(list.meta.total)
  const monthParams = new URLSearchParams(params)
  monthParams.set('month', '5')
  expect((await listPublicLogs(monthParams)).meta.total).toBe(1)
  expect((await getLogCalendar(monthParams)).total).toBe(1)
})
test('普通编辑与批量标签审计保留真实变化字段和关系', async () => {
  const log = await make({ title: '审计原题', images: ['/uploads/old.png'] })
  const updated = await updateLog(
    log.id,
    { revision: 1, title: '审计新题', content: '修改正文', logDate: '2023-04-05', images: [] },
    request(),
  )
  const audit = await prisma.auditLog.findFirstOrThrow({
    where: { resource: 'log', resourceId: log.id, action: 'update' },
  })
  expect(audit.before).toMatchObject({
    title: '审计原题',
    content: '正文',
    logDate: '2024-02-29T00:00:00.000Z',
    images: ['/uploads/old.png'],
    revision: 1,
  })
  expect(audit.after).toMatchObject({
    title: '审计新题',
    content: '修改正文',
    logDate: '2023-04-05T00:00:00.000Z',
    images: [],
    revision: 2,
  })
  const tag = await prisma.tag.create({
    data: { name: '日志审计标签', slug: `log-audit-${Date.now()}` },
  })
  try {
    await bulkLogs(
      {
        ids: [log.id],
        revisions: { [log.id]: updated.revision },
        action: 'addTags',
        payload: { tagIds: [tag.id] },
      },
      request(),
    )
    const added = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: log.id, action: 'addTags' },
    })
    expect(added.before).toMatchObject({ tagIds: [] })
    expect(added.after).toMatchObject({ tagIds: [tag.id] })
    await bulkLogs(
      {
        ids: [log.id],
        revisions: { [log.id]: 3 },
        action: 'removeTags',
        payload: { tagIds: [tag.id] },
      },
      request(),
    )
    const removed = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: log.id, action: 'removeTags' },
    })
    expect(removed.before).toMatchObject({ tagIds: [tag.id] })
    expect(removed.after).toMatchObject({ tagIds: [] })
  } finally {
    await prisma.tag.delete({ where: { id: tag.id } })
  }
})
test('日期范围公开后台日历一致，ISO时间按上海日期归一并拒绝倒置', async () => {
  const a = await make({ title: '范围合同唯一', logDate: '2023-05-06' })
  await make({ title: '范围合同唯一', logDate: '2023-05-07' })
  const params = new URLSearchParams({
    q: '范围合同唯一',
    year: '2023',
    from: '2023-05-05T16:00:00Z',
    to: '2023-05-06',
  })
  expect((await listPublicLogs(params)).data.map((x) => x.id)).toEqual([a.id])
  expect((await listAdminLogs(params, request())).data.map((x) => x.id)).toEqual([a.id])
  expect((await getLogCalendar(params)).total).toBe(1)
  await expect(listPublicLogs(new URLSearchParams({ from: '2023-02-30' }))).rejects.toBeTruthy()
  await expect(
    listAdminLogs(new URLSearchParams({ from: '2023-05-07', to: '2023-05-06' }), request()),
  ).rejects.toMatchObject({ status: 400 })
})
test('后台多状态列表日历过滤与安全DTO稀疏字段', async () => {
  const draft = await make({ title: '多状态合同唯一', status: 'DRAFT' }),
    archived = await make({ title: '多状态合同唯一', status: 'ARCHIVED' })
  await make({ title: '多状态合同唯一' })
  const params = new URLSearchParams({
    q: '多状态合同唯一',
    status: 'DRAFT,ARCHIVED',
    year: '2024',
    fields: 'id,title',
  })
  const result = await listAdminLogs(params, request())
  expect(result.data.map((x) => x.id).sort()).toEqual([draft.id, archived.id].sort())
  expect(result.data.every((x) => Object.keys(x).sort().join(',') === 'id,title')).toBe(true)
  expect((await listAdminLogCalendar(params, request())).total).toBe(2)
  const publicResult = await listPublicLogs(
    new URLSearchParams({ q: '多状态合同唯一', fields: 'id,title' }),
  )
  expect(publicResult.meta.total).toBe(1)
  expect(Object.keys(publicResult.data[0]).sort()).toEqual(['id', 'title'])
  for (const fields of ['content', 'authorId', 'deletedAt', 'passwordHash', '__proto__'])
    await expect(listPublicLogs(new URLSearchParams({ fields }))).rejects.toMatchObject({
      status: 400,
    })
  await expect(
    listAdminLogs(new URLSearchParams({ status: 'DRAFT,INVALID' }), request()),
  ).rejects.toMatchObject({ status: 400 })
})
test('非法ISO时区偏移不会触发日期内部错误，公开后台日历均返回输入错误', async () => {
  for (const from of ['2023-05-06T00:00:00+99:99', '2023-05-06T00:00:00+24:00']) {
    const params = new URLSearchParams({ year: '2023', from })
    for (const read of [
      () => listPublicLogs(params),
      () => listAdminLogs(params, request()),
      () => getLogCalendar(params),
      () => listAdminLogCalendar(params, request()),
    ])
      await expect(read()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
  }
})

test('日志草稿哈希24h预览可读，过期软删除及模块关闭立即404', async () => {
  const draft = await make({ status: 'DRAFT', images: ['/uploads/preview.png'] })
  await expect(getPublicLog(draft.id)).rejects.toMatchObject({ status: 404 })
  const before = Date.now(),
    preview = await createLogPreviewToken(draft.id, request())
  expect(preview.url).toBe(`/preview/${preview.token}`)
  expect(preview.expiresAt.getTime() - before).toBeGreaterThanOrEqual(86400000)
  expect(preview.expiresAt.getTime() - before).toBeLessThan(86401000)
  const row = await prisma.previewToken.findFirstOrThrow({
    where: { kind: 'log', contentId: draft.id },
  })
  expect(row.hash).not.toBe(preview.token)
  expect(row.hash).toMatch(/^[a-f0-9]{64}$/)
  expect((await getPreviewLog(preview.token)).id).toBe(draft.id)
  await prisma.module.update({
    where: { key: 'log' },
    data: { config: { types: { DAILY: false, EVENT: true, SUMMARY: true } } },
  })
  expect((await getPreviewLog(preview.token)).id).toBe(draft.id)
  await prisma.module.update({ where: { key: 'log' }, data: { enabled: false } })
  await expect(getPreviewLog(preview.token)).rejects.toMatchObject({ status: 404 })
  await expect(createLogPreviewToken(draft.id, request())).rejects.toMatchObject({ status: 404 })
  await prisma.module.update({
    where: { key: 'log' },
    data: {
      enabled: true,
      config: { types: { DAILY: true, EVENT: true, SUMMARY: true }, pageSize: 3 },
    },
  })
  await deleteLog(draft.id, 1, request())
  await expect(getPreviewLog(preview.token)).rejects.toMatchObject({ status: 404 })
  await restoreLog(draft.id, 2, request())
  await prisma.previewToken.update({ where: { hash: row.hash }, data: { expiresAt: new Date(0) } })
  await expect(getPreviewLog(preview.token)).rejects.toMatchObject({ status: 404 })
  await expect(getPreviewLog('invalid')).rejects.toMatchObject({ status: 404 })
})
test('预览凭据创建允许VIEWER但POST必须同源且账号会话有效', async () => {
  const draft = await make({ status: 'DRAFT' })
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  try {
    expect((await createLogPreviewToken(draft.id, request())).token).toBeTruthy()
    await expect(
      createLogPreviewToken(
        draft.id,
        new Request('http://localhost:3000/api/v1/admin/logs', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, origin: 'https://evil.test' },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })
    await expect(createLogPreviewToken(draft.id, request())).rejects.toMatchObject({ status: 401 })
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN', isActive: true } })
  }
})
test('日志预览创建共用后台120次15分钟额度，第121次429且不落token', async () => {
  const draft = await make({ status: 'DRAFT' }),
    key = `adminwrite:${userId}`
  await prisma.user.update({ where: { id: userId }, data: { role: 'VIEWER' } })
  try {
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 119, expiresAt: new Date(Date.now() + 900000) },
      update: { count: 119, expiresAt: new Date(Date.now() + 900000) },
    })
    const before = await prisma.previewToken.count({ where: { contentId: draft.id, kind: 'log' } })
    expect((await createLogPreviewToken(draft.id, request())).token).toBeTruthy()
    expect((await prisma.rateLimit.findUniqueOrThrow({ where: { key } })).count).toBe(120)
    await expect(createLogPreviewToken(draft.id, request())).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    })
    expect(await prisma.previewToken.count({ where: { contentId: draft.id, kind: 'log' } })).toBe(
      before + 1,
    )
  } finally {
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
    await prisma.rateLimit.deleteMany({ where: { key } })
  }
})
