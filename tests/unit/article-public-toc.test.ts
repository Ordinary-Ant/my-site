import { beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getPublicArticle } from '@/lib/services/article'
import ContentPage from '@/app/(site)/[...path]/page'

const mocks = vi.hoisted(() => ({
  article: vi.fn(),
  module: vi.fn(),
  modules: vi.fn(),
  profile: vi.fn(),
  settings: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    article: { findFirst: mocks.article },
    module: { findUnique: mocks.module, findMany: mocks.modules },
    profile: { findUnique: mocks.profile },
    setting: { findMany: mocks.settings },
  },
}))
vi.mock('@/lib/services/auth', () => ({ requirePermission: vi.fn() }))
vi.mock('@/lib/services/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/services/cache', () => ({ invalidateContent: vi.fn() }))
vi.mock('@/lib/services/settings', () => ({ readKnownSettings: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  const articleModule = {
    key: 'article',
    name: '文章',
    route: '/articles',
    enabled: true,
    config: {},
  }
  mocks.modules.mockResolvedValue([articleModule])
  mocks.module.mockResolvedValue(articleModule)
  mocks.profile.mockResolvedValue({ contactVisible: false, email: 'hi@example.com' })
  mocks.settings.mockResolvedValue([])
  mocks.article.mockResolvedValue({
    id: 'article-1',
    slug: 'contact-test',
    title: '公开目录',
    content: '## Contact hi@example.com\n正文\n\n## Contact\n第二节',
    tags: [],
    readingTime: 1,
    publishedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  })
})

it('公开目录在正文脱敏后生成，重名标题的锚点按渲染顺序去重', async () => {
  const article = await getPublicArticle('contact-test')
  expect(article.content.includes('hi@example.com')).toBe(false)
  expect(article.toc.map((heading) => heading.id)).toEqual(['contact', 'contact-1'])
  expect(article.toc.map((heading) => heading.text.trim())).toEqual(['Contact', 'Contact'])
})

it('阅读页每个脱敏目录链接都指向实际正文标题', async () => {
  const html = renderToStaticMarkup(
    await ContentPage({
      params: Promise.resolve({ path: ['articles', 'contact-test'] }),
      searchParams: Promise.resolve({}),
    }),
  )
  const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])
  const headings = [...html.matchAll(/<h[2-4] id="([^"]+)"/g)].map((match) => match[1])
  expect(targets).toEqual(headings)
  expect(targets).toEqual(['contact', 'contact-1'])
  expect(html.includes('hi@example.com')).toBe(false)
})

it('允许公开联系方式时保留原文目录锚点', async () => {
  mocks.profile.mockResolvedValue({ contactVisible: true, email: 'hi@example.com' })
  const article = await getPublicArticle('contact-test')
  expect(article.content).toContain('hi@example.com')
  expect(article.toc.map((heading) => heading.id)).toEqual(['contact-hiexamplecom', 'contact'])
})
