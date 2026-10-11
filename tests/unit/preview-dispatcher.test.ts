import { beforeEach, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import Preview, { metadata, revalidate, dynamic } from '@/app/preview/[token]/page'
const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  article: vi.fn(),
  log: vi.fn(),
  project: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { previewToken: { findUnique: mocks.token } } }))
vi.mock('@/lib/services/article', () => ({ getPreviewArticle: mocks.article }))
vi.mock('@/lib/services/log', () => ({ getPreviewLog: mocks.log }))
vi.mock('@/lib/services/project', () => ({ getPreviewProject: mocks.project }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/components/site/markdown', () => ({
  Markdown: ({ source }: { source: string }) => createElement('p', null, source),
}))
vi.mock('@/components/site/image-gallery', () => ({
  default: ({ images }: { images: string[] }) =>
    createElement('div', { 'aria-label': '图片图集' }, images.join(',')),
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockResolvedValue({ kind: 'log', expiresAt: new Date(Date.now() + 60000) })
  mocks.log.mockResolvedValue({
    title: '草稿日志',
    content: '预览正文',
    images: ['/uploads/a.png'],
  })
  mocks.article.mockResolvedValue({ title: '草稿文章', content: '文章正文' })
})
test('预览按哈希凭据类型分发日志与图集，无公开邻居与导航', async () => {
  const html = renderToStaticMarkup(
    await Preview({ params: Promise.resolve({ token: 'secret-token' }) }),
  )
  expect(mocks.log).toHaveBeenCalledWith('secret-token')
  expect(mocks.article).not.toHaveBeenCalled()
  expect(html).toContain('预览正文')
  expect(html).toContain('/uploads/a.png')
  expect(html).not.toContain('<nav')
  expect(mocks.token.mock.calls[0][0].where.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(dynamic).toBe('force-dynamic')
  expect(revalidate).toBe(0)
  expect(metadata.robots).toEqual({ index: false, follow: false })
})
test('原文章预览仍通过文章服务读取', async () => {
  mocks.token.mockResolvedValue({ kind: 'article', expiresAt: new Date(Date.now() + 60000) })
  expect(
    renderToStaticMarkup(await Preview({ params: Promise.resolve({ token: 'article' }) })),
  ).toContain('文章正文')
  expect(mocks.article).toHaveBeenCalledWith('article')
  expect(mocks.log).not.toHaveBeenCalled()
})
test('缺失过期及未知类型凭据均404', async () => {
  for (const token of [
    null,
    { kind: 'log', expiresAt: new Date(0) },
    { kind: 'invalid', expiresAt: new Date(Date.now() + 60000) },
  ]) {
    mocks.token.mockResolvedValue(token)
    await expect(Preview({ params: Promise.resolve({ token: 'bad' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  }
})

test('作品私有预览允许没有长文，仍展示简介、亮点和图集', async () => {
  mocks.token.mockResolvedValue({ kind: 'project', expiresAt: new Date(Date.now() + 60000) })
  mocks.project.mockResolvedValue({
    title: '草稿作品',
    description: '解决部署问题',
    subtitle: '首屏快50%',
    content: null,
    coverImage: '/media/a.png',
    gallery: ['/media/b.png'],
    highlights: ['服务12条业务线'],
    links: { demo: '/demo' },
  })
  const html = renderToStaticMarkup(
    await Preview({ params: Promise.resolve({ token: 'project-token' }) }),
  )
  expect(mocks.project).toHaveBeenCalledWith('project-token')
  expect(html).toContain('解决部署问题')
  expect(html).toContain('服务12条业务线')
  expect(html).toContain('/media/b.png')
  expect(html).not.toContain('<nav')
})
