import { afterAll, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

test('发布时间回填只修复历史已发布空时间，重跑不覆盖草稿和未来计划', async () => {
  const prefix = `migration-${Date.now()}`
  const date = new Date('2025-01-01T00:00:00Z')
  const future = new Date('2099-01-01T00:00:00Z')
  const legacy = await db.log.create({
    data: { title: prefix, content: '旧日志', logDate: date, status: 'PUBLISHED' },
  })
  const draft = await db.log.create({
    data: { title: prefix, content: '草稿', logDate: date, status: 'DRAFT' },
  })
  const scheduled = await db.project.create({
    data: {
      slug: prefix,
      title: prefix,
      description: '未来计划',
      status: 'PUBLISHED',
      publishedAt: future,
    },
  })
  const statements = readFileSync(
    'prisma/migrations/20261007044400_publication_backfill/migration.sql',
    'utf8',
  )
    .split(';')
    .filter((s) => s.trim())
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const sql of statements) await db.$executeRawUnsafe(sql)
    }
    expect((await db.log.findUniqueOrThrow({ where: { id: legacy.id } })).publishedAt).toEqual(date)
    expect((await db.log.findUniqueOrThrow({ where: { id: draft.id } })).publishedAt).toBeNull()
    expect(
      (await db.project.findUniqueOrThrow({ where: { id: scheduled.id } })).publishedAt,
    ).toEqual(future)
  } finally {
    await db.log.deleteMany({ where: { id: { in: [legacy.id, draft.id] } } })
    await db.project.delete({ where: { id: scheduled.id } })
  }
})
