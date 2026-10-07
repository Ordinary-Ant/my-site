import { expect, test } from 'vitest'
import { ArticleCreateSchema, ArticleUpdateSchema } from '@/lib/validators/article'

test('文章新建默认为草稿，拒绝越权字段和不安全媒体路径', () => {
  expect(ArticleCreateSchema.parse({ title: '文章', content: '正文' }).status).toBe('DRAFT')
  expect(
    ArticleCreateSchema.safeParse({ title: '文章', content: '正文', viewCount: 999 }).success,
  ).toBe(false)
  for (const coverImage of ['javascript:alert(1)', '//evil.test/a.jpg', '/uploads/../private']) {
    expect(
      ArticleCreateSchema.safeParse({ title: '文章', content: '正文', coverImage }).success,
    ).toBe(false)
  }
})

test('更新必须携带revision，空摘要可以清除，空标题和发布空时间不能混淆', () => {
  expect(ArticleUpdateSchema.safeParse({ title: '新标题' }).success).toBe(false)
  expect(ArticleUpdateSchema.parse({ revision: 1, summary: null })).toEqual({
    revision: 1,
    summary: null,
  })
  expect(ArticleUpdateSchema.safeParse({ revision: 1, title: null }).success).toBe(false)
  expect(ArticleUpdateSchema.safeParse({ revision: 1, slug: 'UpperCase' }).success).toBe(false)
})
