import { afterAll, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
afterAll(() => db.$disconnect())

test('seed重复执行不重复插入，公开日志和作品具备发布时间', async () => {
  const seed = () => {
    const result = spawnSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'],
      { env: process.env, encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error('独立测试库seed失败')
  }
  const counts = async () =>
    Promise.all([
      db.user.count(),
      db.module.count(),
      db.setting.count(),
      db.profile.count(),
      db.article.count(),
      db.log.count(),
      db.project.count(),
      db.timelineItem.count(),
    ])
  seed()
  const first = await counts()
  seed()
  expect(await counts()).toEqual(first)
  expect(await db.log.count({ where: { status: 'PUBLISHED', publishedAt: null } })).toBe(0)
  expect(await db.project.count({ where: { status: 'PUBLISHED', publishedAt: null } })).toBe(0)
})
