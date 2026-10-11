import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NotFound from '@/app/not-found'
import { getPublicSite } from '@/lib/services/public-site'
vi.mock('@/lib/services/public-site', () => ({ getPublicSite: vi.fn() }))

test('404推荐入口只使用已启用栏目的当前路径', async () => {
  vi.mocked(getPublicSite).mockResolvedValue({
    modules: [{ key: 'article', route: '/writing' }],
  } as unknown as Awaited<ReturnType<typeof getPublicSite>>)
  const enabled = renderToStaticMarkup(await NotFound())
  expect(enabled).toContain('href="/writing"')
  expect(enabled).not.toContain('href="/articles"')
  vi.mocked(getPublicSite).mockResolvedValue({ modules: [] } as unknown as Awaited<
    ReturnType<typeof getPublicSite>
  >)
  expect(renderToStaticMarkup(await NotFound())).not.toContain('看看文章')
})
