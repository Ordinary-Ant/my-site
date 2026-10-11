import { expect, test } from 'vitest'
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectReorderSchema,
} from '@/lib/validators/project'

const body = { title: '作品', slug: 'my-project', description: '解决问题' }
test('轻量作品默认发布，长文可空，安全外链只接受已知键', () => {
  expect(
    ProjectCreateSchema.parse({ ...body, links: { demo: 'https://example.com' } }).status,
  ).toBe('PUBLISHED')
  expect(ProjectCreateSchema.parse({ ...body, content: null }).content).toBeNull()
  for (const extra of [
    { links: { other: '/x' } },
    { links: { demo: 'javascript:alert(1)' } },
    { links: { demo: 'data:text/html,x' } },
    { title: '' },
    { slug: 'BAD' },
    { description: '' },
    { viewCount: 1 },
    { gallery: ['javascript:x'] },
  ])
    expect(ProjectCreateSchema.safeParse({ ...body, ...extra }).success).toBe(false)
})
test('字段清空与整数组替换，更新必需revision且日期顺序合理', () => {
  expect(
    ProjectUpdateSchema.parse({
      revision: 1,
      links: null,
      coverImage: null,
      content: null,
      gallery: [],
      techStack: [],
      highlights: [],
      tagIds: [],
    }),
  ).toEqual({
    revision: 1,
    links: null,
    coverImage: null,
    content: null,
    gallery: [],
    techStack: [],
    highlights: [],
    tagIds: [],
  })
  expect(ProjectUpdateSchema.safeParse({ title: '更新' }).success).toBe(false)
  expect(
    ProjectCreateSchema.safeParse({ ...body, startDate: '2024-02-29', endDate: '2023-01-01' })
      .success,
  ).toBe(false)
  expect(ProjectCreateSchema.safeParse({ ...body, startDate: '2023-02-29' }).success).toBe(false)
  expect(
    ProjectCreateSchema.safeParse({ ...body, techStack: Array(51).fill('React') }).success,
  ).toBe(false)
})
test('排序逐项携带revision并拒绝重复标识', () => {
  const item = { id: 'cm000000000000000000000000', order: 0, revision: 1 }
  expect(ProjectReorderSchema.safeParse({ items: [item] }).success).toBe(true)
  expect(ProjectReorderSchema.safeParse({ items: [item, item] }).success).toBe(false)
  expect(ProjectReorderSchema.safeParse({ items: [{ ...item, revision: 0 }] }).success).toBe(false)
})
