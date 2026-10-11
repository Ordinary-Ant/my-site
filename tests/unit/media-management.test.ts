import { expect, test } from 'vitest'
import { mediaFolderSchema, mediaDeduplicateSchema, mediaQuerySchema } from '@/lib/validators/media'

test('目录严格校验路径并去末尾斜杠', () => {
  expect(mediaFolderSchema.parse({ path: '/作品/2026/' })).toEqual({ path: '/作品/2026' })
  expect(mediaFolderSchema.parse({ path: '/' })).toEqual({ path: '/' })
  for (const path of [
    '/../x',
    '//x',
    '/x\\y',
    '/x%2fy',
    '/x\u0000',
    'relative',
    '/' + 'x'.repeat(200),
  ])
    expect(mediaFolderSchema.safeParse({ path }).success).toBe(false)
  expect(mediaFolderSchema.safeParse({ path: '/ok', extra: true }).success).toBe(false)
})

test('搜索trim并限制200字，省略目录与根目录语义不同', () => {
  expect(mediaQuerySchema.parse({ q: '  Alt  ' })).toMatchObject({ q: 'Alt' })
  expect(mediaQuerySchema.parse({}).folder).toBeUndefined()
  expect(mediaQuerySchema.parse({ folder: '/' }).folder).toBe('/')
  expect(mediaQuerySchema.parse({ folder: '/existing/' }).folder).toBe('/existing/')
  expect(mediaQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false)
})

test('秒传请求不接受客户端metadata、非小写sha256或非法大小', () => {
  const input = { hash: 'a'.repeat(64), size: 123, mimeType: 'image/png' }
  expect(mediaDeduplicateSchema.parse(input)).toEqual(input)
  for (const extra of [{ hash: 'A'.repeat(64) }, { size: 0 }, { size: 1.5 }, { alt: '更改' }])
    expect(mediaDeduplicateSchema.safeParse({ ...input, ...extra }).success).toBe(false)
})
