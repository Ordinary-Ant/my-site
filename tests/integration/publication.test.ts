import { expect, test, vi } from 'vitest'
import { Prisma } from '@prisma/client'
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
import { revalidateTag } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { authorizePublicationJob, processDuePublications } from '@/lib/services/publication'
test('到期发布按游标失效，未来和软删不处理，重复执行无重复事件', async () => {
  const now = new Date()
  const prefix = `publication-${Date.now()}`
  const saved = await prisma.setting.findUnique({ where: { key: 'jobs.publication.cursor' } })
  try {
    await prisma.setting.upsert({
      where: { key: 'jobs.publication.cursor' },
      create: {
        key: 'jobs.publication.cursor',
        value: new Date(now.getTime() - 120000).toISOString(),
      },
      update: { value: new Date(now.getTime() - 120000).toISOString() },
    })
    await prisma.article.createMany({
      data: [
        {
          title: prefix,
          slug: `${prefix}-due`,
          content: '正文',
          status: 'PUBLISHED',
          publishedAt: new Date(now.getTime() - 60000),
        },
        {
          title: prefix,
          slug: `${prefix}-future`,
          content: '正文',
          status: 'PUBLISHED',
          publishedAt: new Date(now.getTime() + 60000),
        },
        {
          title: prefix,
          slug: `${prefix}-deleted`,
          content: '正文',
          status: 'PUBLISHED',
          publishedAt: new Date(now.getTime() - 60000),
          deletedAt: now,
        },
      ],
    })
    vi.mocked(revalidateTag).mockClear()
    expect((await processDuePublications(now)).article).toBe(1)
    expect(revalidateTag).toHaveBeenCalledWith('article')
    vi.mocked(revalidateTag).mockClear()
    expect((await processDuePublications(now)).article).toBe(0)
    expect(revalidateTag).not.toHaveBeenCalled()
    expect((await processDuePublications(new Date(now.getTime() + 61000))).article).toBe(1)
  } finally {
    await prisma.article.deleteMany({ where: { title: prefix } })
    if (saved)
      await prisma.setting.update({
        where: { key: saved.key },
        data: { value: saved.value === null ? Prisma.JsonNull : saved.value },
      })
    else await prisma.setting.deleteMany({ where: { key: 'jobs.publication.cursor' } })
  }
})
test('调度不接受空配置、Cookie或错误Bearer，Unicode错误凭据安全拒绝', () => {
  const previous = env.REVALIDATE_SECRET
  try {
    env.REVALIDATE_SECRET = undefined
    expect(() => authorizePublicationJob(new Request('http://localhost/jobs'))).toThrow(
      expect.objectContaining({ status: 503 }),
    )
    env.REVALIDATE_SECRET = 'test-machine-only-key-at-least-32-characters'
    for (const value of ['', 'Bearer bad', `Bearer ${'é'.repeat(env.REVALIDATE_SECRET.length)}`])
      expect(() =>
        authorizePublicationJob(
          new Request('http://localhost/jobs', {
            headers: { authorization: value, cookie: 'at=fake' },
          }),
        ),
      ).toThrow(expect.objectContaining({ status: 401 }))
    expect(() =>
      authorizePublicationJob(
        new Request('http://localhost/jobs', {
          headers: { authorization: `Bearer ${env.REVALIDATE_SECRET}` },
        }),
      ),
    ).not.toThrow()
  } finally {
    env.REVALIDATE_SECRET = previous
  }
})
