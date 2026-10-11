import { expect, test } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getHomeFeed } from '@/lib/services/public-site'
import { mergeModuleConfig } from '@/lib/validators/module'

test('首页同样隐藏未来日期未置顶日志，置顶不能绕过未来发布时间', async () => {
  const original = await prisma.module.findUniqueOrThrow({ where: { key: 'log' } })
  const ids: string[] = []
  try {
    const config = mergeModuleConfig('log', original.config, {
      home: { enabled: true, limit: 20 },
      types: { DAILY: true },
    })
    await prisma.module.update({
      where: { key: 'log' },
      data: { enabled: true, config: config as Prisma.InputJsonValue },
    })
    for (const [pin, publishedAt] of [
      [false, new Date('2020-01-01')],
      [true, new Date('2020-01-01')],
      [true, new Date('2099-01-01')],
    ] as const) {
      const item = await prisma.log.create({
        data: {
          title: '首页未来日期验收',
          content: '日期边界',
          type: 'DAILY',
          logDate: new Date('2098-01-01'),
          isPinned: pin,
          status: 'PUBLISHED',
          publishedAt,
        },
      })
      ids.push(item.id)
    }
    const home = await getHomeFeed()
    const visible =
      home.sections
        .find((section) => section.key === 'log')
        ?.items.map((item) =>
          item && typeof item === 'object' && 'id' in item ? item.id : null,
        ) ?? []
    expect(visible).not.toContain(ids[0])
    expect(visible).toContain(ids[1])
    expect(visible).not.toContain(ids[2])
  } finally {
    await prisma.log.deleteMany({ where: { id: { in: ids } } })
    await prisma.module.update({
      where: { key: 'log' },
      data: {
        enabled: original.enabled,
        config:
          original.config === null ? Prisma.JsonNull : (original.config as Prisma.InputJsonValue),
      },
    })
    await prisma.$disconnect()
  }
})
