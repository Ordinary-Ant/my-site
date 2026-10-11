import { expect, test } from 'vitest'
import { emptyProjectDraft, projectPayload, projectDraftFromRecord } from '@/lib/project-draft'
test('作品编辑只取已知字段，保留发布时间精度和显式空值', () => {
  const record = {
    ...projectPayload(emptyProjectDraft()),
    id: 'server-id',
    revision: 9,
    title: '作品',
    slug: 'work',
    description: '解决问题',
    publishedAt: '2025-01-15T03:04:05.678Z',
    tags: [{ id: 'tag' }],
    coverImage: null,
  }
  const draft = projectDraftFromRecord(record)
  const body = projectPayload(draft)
  expect(body.publishedAt).toBe(record.publishedAt)
  expect(body.coverImage).toBeNull()
  expect(body.tagIds).toEqual(['tag'])
  expect(body).not.toHaveProperty('id')
  expect(body).not.toHaveProperty('revision')
})
test('技术栈成果和图集数组整体替换，空外链明确清空', () => {
  const draft = emptyProjectDraft()
  expect(projectPayload(draft).links).toBeNull()
  draft.techStack = 'React\nTypeScript\nReact'
  draft.highlights = '交付12个关卡\n复用率78%'
  expect(projectPayload(draft).techStack).toEqual(['React', 'TypeScript'])
  expect(projectPayload(draft).highlights).toEqual(['交付12个关卡', '复用率78%'])
})
