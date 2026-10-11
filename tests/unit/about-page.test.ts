import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ContentPage, { generateMetadata } from '@/app/(site)/[...path]/page'
import { AboutPage } from '@/components/site/about-page'
const mocks = vi.hoisted(() => ({ module: vi.fn(), profile: vi.fn() }))
vi.mock('@/lib/services/public-site', () => ({
  requirePageModule: mocks.module,
  applyPublicPrivacy: (v: unknown) => v,
  listVisibleModules: async () => [],
}))
vi.mock('@/lib/services/profile', () => ({ getPublicProfile: mocks.profile }))
vi.mock('@/lib/services/article', () => ({
  getPublicArticle: vi.fn(),
  listPublicArticles: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
test('About自定义动态路径展示Hero，关闭全部区块不白屏且无联系方式', async () => {
  mocks.module.mockResolvedValue({ key: 'about', name: '个人介绍', route: '/me', config: {} })
  mocks.profile.mockResolvedValue({ name: '真实姓名', headline: '具体定位' })
  const element = await ContentPage({
    params: Promise.resolve({ path: ['me'] }),
    searchParams: Promise.resolve({}),
  })
  expect(element.type).toBe(AboutPage)
  const html = renderToStaticMarkup(await AboutPage())
  expect(html).toContain('真实姓名')
  expect(html).toContain('具体定位')
  expect(html).not.toContain('mailto:')
  expect(html).not.toContain('profile-contact')
})

test('About metadata 使用公开个人定位与头像', async () => {
  mocks.module.mockResolvedValue({
    key: 'about',
    name: '个人介绍',
    description: '栏目说明',
    route: '/me',
    config: {},
  })
  mocks.profile.mockResolvedValue({ headline: '公开定位', avatar: '/uploads/avatar.png' })
  const result = await generateMetadata({
    params: Promise.resolve({ path: ['me'] }),
    searchParams: Promise.resolve({}),
  })
  expect(result.description).toBe('公开定位')
  expect(result.openGraph?.images).toEqual(['/uploads/avatar.png'])
})
