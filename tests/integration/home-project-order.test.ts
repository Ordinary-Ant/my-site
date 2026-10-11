import { expect, test } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getHomeFeed } from '@/lib/services/public-site'
import { mergeModuleConfig } from '@/lib/validators/module'

test('首页精选作品按人工顺序和开始日期排序，而不按发布时刻', async () => {
  const original = await prisma.module.findUniqueOrThrow({ where: { key: 'portfolio' } })
  const ids: string[] = []
  try {
    const config = mergeModuleConfig('portfolio', original.config, {
      home: { enabled: true, limit: 20 },
      types: { REPO: true },
    })
    await prisma.module.update({
      where: { key: 'portfolio' },
      data: { enabled: true, config: config as Prisma.InputJsonValue },
    })
    for (const [startDate, publishedAt] of [
      ['2024-01-01', '2020-01-01'],
      ['2023-01-01', '2021-01-01'],
    ] as const) {
      const item = await prisma.project.create({
        data: {
          title: '首页排序验收',
          slug: 'home-order-' + Date.now() + '-' + ids.length,
          description: '排序边界',
          type: 'REPO',
          featured: true,
          order: 0,
          status: 'PUBLISHED',
          startDate: new Date(startDate),
          publishedAt: new Date(publishedAt),
        },
      })
      ids.push(item.id)
    }
    const home = await getHomeFeed()
    const ordered =
      home.sections
        .find((section) => section.key === 'portfolio')
        ?.items.map((item) =>
          item && typeof item === 'object' && 'id' in item ? item.id : null,
        ) ?? []
    expect(ordered).toContain(ids[0])
    expect(ordered).toContain(ids[1])
    expect(ordered.indexOf(ids[0])).toBeLessThan(ordered.indexOf(ids[1]))
  } finally {
    await prisma.project.deleteMany({ where: { id: { in: ids } } })
    await prisma.module.update({
      where: { key: 'portfolio' },
      data: {
        enabled: original.enabled,
        config:
          original.config === null ? Prisma.JsonNull : (original.config as Prisma.InputJsonValue),
      },
    })
    await prisma.$disconnect()
  }
})
