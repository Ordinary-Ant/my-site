import { expect, test, vi } from 'vitest'
import {
  CategoryCreateSchema,
  CategoryUpdateSchema,
  TagCreateSchema,
  TagUpdateSchema,
  TaxonomyMergeSchema,
  CategoryReorderSchema,
} from '@/lib/validators/taxonomy'
test('分类输入严格校验并允许清空可空字段', () => {
  expect(CategoryCreateSchema.parse({ name: '分类', slug: 'topic' })).toMatchObject({
    order: 0,
    parentId: null,
  })
  expect(CategoryCreateSchema.safeParse({ name: 'x', slug: 'UPPER' }).success).toBe(false)
  expect(CategoryCreateSchema.safeParse({ name: 'x', slug: 'x', color: 'red' }).success).toBe(false)
  expect(CategoryUpdateSchema.parse({ revision: 1, color: null, parentId: null })).toMatchObject({
    color: null,
    parentId: null,
  })
  expect(CategoryUpdateSchema.safeParse({ revision: 1, unknown: 1 }).success).toBe(false)
})
test('标签slug创建后不可修改且合并必须去重', () => {
  expect(TagCreateSchema.parse({ name: 'tag', slug: 'tag' }).slug).toBe('tag')
  expect(TagUpdateSchema.safeParse({ revision: 1, slug: 'new' }).success).toBe(false)
  const target = { id: 'a', revision: 1 },
    source = { id: 'b', revision: 1 }
  expect(TaxonomyMergeSchema.safeParse({ target, sources: [source] }).success).toBe(true)
  expect(TaxonomyMergeSchema.safeParse({ target, sources: [target] }).success).toBe(false)
  expect(TaxonomyMergeSchema.safeParse({ target, sources: [source, source] }).success).toBe(false)
  expect(
    CategoryReorderSchema.safeParse({
      items: [
        { ...target, order: 0 },
        { ...target, order: 1 },
      ],
    }).success,
  ).toBe(false)
})

vi.mock('@/lib/services/auth', () => ({
  requirePermission: vi.fn(async () => ({ id: 'preview-viewer' })),
}))
vi.mock('@/lib/services/rate-limit', () => ({
  consumeRateLimit: vi.fn(async () => {
    throw Object.assign(new Error('请求过于频繁'), { status: 429 })
  }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async () => {
      throw new Error('限流前不得锁词表和正文')
    }),
  },
}))
vi.mock('@/lib/services/public-site', () => ({ applyPublicPrivacy: vi.fn() }))
vi.mock('@/lib/services/cache', () => ({ invalidateContent: vi.fn() }))

test('合并预览使用读取权限并在锁正文前消耗共享写限流', async () => {
  const { previewTagMerge } = await import('@/lib/services/taxonomy')
  const { consumeRateLimit } = await import('@/lib/services/rate-limit')
  const { requirePermission } = await import('@/lib/services/auth')
  const { prisma } = await import('@/lib/prisma')
  const request = new Request('http://localhost:3000/api/v1/admin/tags/merge/preview', {
    method: 'POST',
  })
  await expect(
    previewTagMerge(
      { target: { id: 'a', revision: 1 }, sources: [{ id: 'b', revision: 1 }] },
      request,
    ),
  ).rejects.toMatchObject({ status: 429 })
  expect(requirePermission).toHaveBeenCalledWith('content:read', request)
  expect(consumeRateLimit).toHaveBeenCalledWith('adminwrite:preview-viewer', 120, 900000)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
