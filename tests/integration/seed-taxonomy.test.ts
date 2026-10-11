import { readFile } from 'node:fs/promises'
import { afterAll, expect, test } from 'vitest'
import { prisma } from '@/lib/prisma'
afterAll(async () => {
  await prisma.$disconnect()
})
test('旧seed slug修复保留三模型关系、处理冲突且幂等，不覆盖自定义项', async () => {
  const databases = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`
  if (!databases[0]?.name.endsWith('_test')) throw new Error('只允许独立测试库')
  const sql = await readFile(
    new URL('../../prisma/migrations/20261010000000_seed_tag_slugs/migration.sql', import.meta.url),
    'utf8',
  )
  await prisma.$transaction(
    async (tx) => {
      const target = await tx.tag.findUniqueOrThrow({ where: { slug: 'performance' } })
      const old = await tx.tag.create({ data: { name: '性能', slug: '性能' } })
      const other = await tx.tag.create({ data: { name: '工程化', slug: '工程化' } })
      const custom = await tx.tag.create({
        data: { name: '性能', slug: 'custom-performance-' + Date.now() },
      })
      const connect = [{ id: old.id }, { id: other.id }]
      const article = await tx.article.create({
        data: {
          title: '迁移文章',
          slug: 'migration-article-' + Date.now(),
          content: '正文保留',
          deletedAt: new Date(),
          tags: { connect },
        },
      })
      const log = await tx.log.create({
        data: {
          title: '迁移日志',
          type: 'DAILY',
          content: '日志正文',
          logDate: new Date('2025-01-01'),
          tags: { connect },
        },
      })
      const project = await tx.project.create({
        data: {
          title: '迁移作品',
          slug: 'migration-project-' + Date.now(),
          description: '作品内容',
          type: 'REPO',
          tags: { connect },
        },
      })
      // SQL来自受版本控制的固定迁移文件，无用户输入。
      await tx.$executeRawUnsafe(sql)
      const repaired = await tx.tag.findUniqueOrThrow({ where: { id: old.id } })
      expect(repaired.slug).toMatch(/^performance-seed-\d+$/)
      expect(repaired.revision).toBe(2)
      expect(await tx.tag.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target)
      expect(await tx.tag.findUniqueOrThrow({ where: { id: custom.id } })).toEqual(custom)
      for (const value of [
        await tx.article.findUniqueOrThrow({ where: { id: article.id }, include: { tags: true } }),
        await tx.log.findUniqueOrThrow({ where: { id: log.id }, include: { tags: true } }),
        await tx.project.findUniqueOrThrow({ where: { id: project.id }, include: { tags: true } }),
      ]) {
        expect(value.revision).toBe(2)
        expect(value.tags.map((tag) => tag.id).sort()).toEqual([old.id, other.id].sort())
      }
      await tx.$executeRawUnsafe(sql)
      expect(await tx.tag.findUniqueOrThrow({ where: { id: old.id } })).toEqual(repaired)
      expect((await tx.article.findUniqueOrThrow({ where: { id: article.id } })).revision).toBe(2)
      await tx.article.delete({ where: { id: article.id } })
      await tx.log.delete({ where: { id: log.id } })
      await tx.project.delete({ where: { id: project.id } })
      await tx.tag.deleteMany({ where: { id: { in: [old.id, other.id, custom.id] } } })
    },
    { timeout: 15000 },
  )
})
