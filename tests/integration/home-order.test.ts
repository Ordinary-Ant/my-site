import { readFileSync } from 'node:fs'
import { afterAll, expect, test } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma'
import { MODULE_REGISTRY } from '../../src/config/modules'
afterAll(async () => {
  await prisma.$disconnect()
})
test('首页默认顺序回填仅修改完整旧seed且重复执行不覆盖自定义', async () => {
  const source = readFileSync(
    'prisma/migrations/20261007185500_home_default_order/migration.sql',
    'utf8',
  )
  const statements = source
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
  const before = await prisma.module.findMany({ where: { key: { in: ['log', 'article'] } } })
  try {
    for (const key of ['log', 'article'] as const) {
      const old = structuredClone(MODULE_REGISTRY[key].defaultConfig)
      old.home!.order = key === 'log' ? 3 : 4
      await prisma.module.update({ where: { key }, data: { config: old as Prisma.InputJsonValue } })
    }
    for (const sql of statements) await prisma.$executeRawUnsafe(sql)
    for (const key of ['log', 'article'] as const) {
      const row = await prisma.module.findUniqueOrThrow({ where: { key } })
      expect(row.config).toEqual(MODULE_REGISTRY[key].defaultConfig)
    }
    const custom = {
      ...MODULE_REGISTRY.article.defaultConfig,
      home: { enabled: false, limit: 2, order: 4 },
    }
    await prisma.module.update({
      where: { key: 'article' },
      data: { config: custom as Prisma.InputJsonValue },
    })
    for (const sql of statements) await prisma.$executeRawUnsafe(sql)
    expect((await prisma.module.findUniqueOrThrow({ where: { key: 'article' } })).config).toEqual(
      custom,
    )
  } finally {
    for (const row of before)
      await prisma.module.update({
        where: { key: row.key },
        data: {
          config: row.config === null ? Prisma.DbNull : (row.config as Prisma.InputJsonValue),
        },
      })
  }
})
