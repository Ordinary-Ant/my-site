import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderServerMarkup } from '../render-server-markup'
import type { Module } from '@prisma/client'
import { ApiError } from '@/lib/api/errors'
import ContentPage, { generateMetadata } from '@/app/(site)/[...path]/page'

const mocks = vi.hoisted(() => ({
  modules: vi.fn(),
  module: vi.fn(),
  profile: vi.fn(),
  settings: vi.fn(),
  list: vi.fn(),
  article: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    module: { findMany: mocks.modules, findUnique: mocks.module },
    profile: { findUnique: mocks.profile },
    setting: { findMany: mocks.settings },
  },
}))
vi.mock('@/lib/services/settings', () => ({ readKnownSettings: vi.fn() }))
vi.mock('@/lib/services/article', () => ({
  listPublicArticles: mocks.list,
  getPublicArticle: mocks.article,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const props = (path = ['articles'], query: Record<string, string> = {}) => ({
  params: Promise.resolve({ path }),
  searchParams: Promise.resolve(query),
})
const render = async (path?: string[], query?: Record<string, string>) =>
  await renderServerMarkup(await ContentPage(props(path, query)))
let articleModule: Module

beforeEach(() => {
  vi.clearAllMocks()
  articleModule = {
    key: 'article',
    name: '文章',
    description: '栏目说明',
    route: '/articles',
    enabled: true,
    navVisible: true,
    navLabel: null,
    navOrder: 4,
    icon: 'file-text',
    isBuiltin: true,
    config: {},
    updatedAt: new Date(),
  }
  mocks.modules.mockImplementation(async (query?: { where?: { enabled?: boolean } }) =>
    query?.where?.enabled === true && !articleModule.enabled ? [] : [articleModule],
  )
  mocks.module.mockResolvedValue({ enabled: true, config: {} })
  mocks.profile.mockResolvedValue({
    contactVisible: false,
    email: 'hidden@example.com',
    phone: '+86 138 0013 8000',
  })
  mocks.settings.mockResolvedValue([])
  mocks.list.mockResolvedValue({
    data: [],
    meta: { page: 1, total: 0, hasPrev: false, hasNext: false },
  })
  mocks.article.mockResolvedValue({
    id: 'article-1',
    slug: 'example',
    title: '测试文章',
    content: '## 小节\n正文',
    publishedAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    readingTime: 1,
    tags: [],
    toc: [{ id: '小节', text: '小节', depth: 2 }],
  })
})

describe('文章页面的公开边界', () => {
  it('公开详情输出安全结构化数据及当前canonical', async () => {
    const html = await render(['articles', 'example'])
    expect(html).toContain('application/ld+json')
    expect(html).toContain('BlogPosting')
    expect(html).toContain('/articles/example')
  })
  it('隐藏联系方式时栏目 HTML 与 metadata 均脱敏', async () => {
    articleModule.name = '文章 hidden@example.com'
    articleModule.description = '联系 +86 138 0013 8000 mailto:hidden@example.com'
    articleModule.config = { intro: null }
    const html = await render()
    const metadata = JSON.stringify(await generateMetadata(props()))
    for (const privateText of ['hidden@example.com', '+86 138 0013 8000', 'mailto:', 'tel:']) {
      expect(html.includes(privateText)).toBe(false)
      expect(metadata.includes(privateText)).toBe(false)
    }
    expect(html).toContain('联系')
    expect(metadata).toContain('文章')
  })

  it('已开启联系方式时保留允许公开的栏目文字', async () => {
    mocks.profile.mockResolvedValue({ contactVisible: true })
    articleModule.name = '文章 hidden@example.com'
    expect(await render()).toContain('hidden@example.com')
    expect((await generateMetadata(props())).title).toBe(articleModule.name)
  })

  it('配置导语与空态使用同一隐私边界', async () => {
    articleModule.config = {
      intro: '导语 hidden@example.com',
      emptyText: '请稍后 +86 138 0013 8000',
    }
    const html = await render()
    expect(html).toContain('导语')
    expect(html).toContain('请稍后')
    expect(html.includes('hidden@example.com')).toBe(false)
    expect(html.includes('+86 138 0013 8000')).toBe(false)
  })
})

describe('文章页面消费栏目配置', () => {
  it('列表显示保存的导语与自定义空态', async () => {
    articleModule.config = { intro: '保存的导语', emptyText: '暂未发布，请稍后' }
    const html = await render()
    expect(html).toContain('保存的导语')
    expect(html).toContain('暂未发布，请稍后')
    expect(html.includes('栏目说明')).toBe(false)
  })

  it('清空导语覆盖后回退说明，清空空态后回退默认文案', async () => {
    articleModule.config = { intro: null, emptyText: null }
    const html = await render()
    expect(html).toContain('栏目说明')
    expect(html).toContain('暂无文章，稍后再来看看。')
  })

  it('关闭目录后保留正文标题但不显示目录', async () => {
    articleModule.config = { showToc: false }
    const html = await render(['articles', 'example'])
    expect(html.includes('文章目录')).toBe(false)
    expect(html).toContain('<h2 id="小节">小节</h2>')
  })

  it('缺省配置使用默认导语、默认空态与目录', async () => {
    const html = await render()
    expect(html).toContain('认真写的一些东西')
    expect(html).toContain('还没有文章')
    expect(await render(['articles', 'example'])).toContain('文章目录')
  })
})

describe('文章路径与404边界', () => {
  it('当前嵌套路径用于详情返回、标签和canonical', async () => {
    articleModule.route = '/writing/notes'
    mocks.article.mockResolvedValue({
      ...(await mocks.article()),
      tags: [{ id: 'tag-1', name: '标签', slug: 'test' }],
    })
    const html = await render(['writing', 'notes', 'example'])
    expect(html).toContain('href="/writing/notes"')
    expect(html).toContain('href="/writing/notes/tag/test"')
    expect((await generateMetadata(props(['writing', 'notes', 'example']))).alternates).toEqual({
      canonical: '/writing/notes/example',
    })
  })

  it('当前路径保留列表分页查询', async () => {
    articleModule.route = '/writing'
    mocks.list.mockResolvedValue({
      data: [],
      meta: { page: 1, total: 20, hasPrev: false, hasNext: true },
    })
    expect(await render(['writing'], { q: 'query', tag: 'tag-1' })).toContain(
      'href="/writing?q=query&amp;tag=tag-1&amp;page=2"',
    )
  })

  it.each(['disabled', 'unknown', 'wrong-module', 'nested-suffix'])('%s 返回404', async (kind) => {
    if (kind === 'disabled') articleModule.enabled = false
    // 日志已接入解析器，未知模块才属于无页面实现的404边界。
    if (kind === 'wrong-module') articleModule.key = 'unsupported'
    const path =
      kind === 'unknown'
        ? ['missing']
        : kind === 'nested-suffix'
          ? ['articles', 'example', 'extra']
          : ['articles']
    await expect(render(path)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.article).not.toHaveBeenCalled()
  })

  it('文章服务的公开404转换为页面404，其他错误继续抛出', async () => {
    mocks.article.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', '文章不存在'))
    await expect(render(['articles', 'example'])).rejects.toThrow('NEXT_NOT_FOUND')
    mocks.article.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', '服务不可用'))
    await expect(render(['articles', 'example'])).rejects.toThrow('服务不可用')
  })
})
