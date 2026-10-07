import { afterAll, expect, test } from 'vitest'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

test('真实 PostgreSQL 迁移具备并发控制与路径约束', async () => {
  const tables = await db.$queryRaw<
    { name: string }[]
  >`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'sessions',
      'rate_limits',
      'route_aliases',
      'preview_tokens',
      'articles',
    ]),
  )
  const key = `test-${Date.now()}`
  try {
    await db.module.create({ data: { key, name: '测试', route: `/test-${key}` } })
    await expect(
      db.module.create({ data: { key: `${key}-2`, name: '冲突', route: `/test-${key}` } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  } finally {
    await db.module.deleteMany({ where: { key: { in: [key, `${key}-2`] } } })
  }
})
