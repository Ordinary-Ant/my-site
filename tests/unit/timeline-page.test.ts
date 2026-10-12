import { expect, test, vi } from 'vitest'
import { renderServerMarkup } from '../render-server-markup'
import ContentPage from '@/app/(site)/[...path]/page'
import { TimelineIndex } from '@/components/site/timeline-pages'
const mocks = vi.hoisted(() => ({ module: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/services/public-site', () => ({
  requirePageModule: mocks.module,
  applyPublicPrivacy: (value: unknown) => value,
}))
vi.mock('@/lib/services/article', () => ({
  getPublicArticle: vi.fn(),
  listPublicArticles: vi.fn(),
}))
vi.mock('@/lib/services/timeline', () => ({ listPublicTimeline: mocks.list }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

test('自定义栏目路径分发时间线，年精度与原生折叠保留完整正文', async () => {
  mocks.module.mockResolvedValue({
    key: 'timeline',
    name: '职业故事',
    description: '经历',
    route: '/journey',
    config: { groupByYear: true, types: { WORK: true }, direction: 'desc' },
  })
  mocks.list.mockResolvedValue({
    data: [
      {
        id: 'one',
        title: '年度经历',
        type: 'WORK',
        startDate: new Date('2023-01-01'),
        startPrecision: 'YEAR',
        endPrecision: 'MONTH',
        endDate: null,
        isCurrent: true,
        highlights: ['实际成果'],
        tags: [],
        description: '完整职业故事',
        revision: 1,
        order: 0,
        visible: true,
        showOnAbout: true,
      },
    ],
    meta: { total: 1 },
  })
  const element = await ContentPage({
    params: Promise.resolve({ path: ['journey'] }),
    searchParams: Promise.resolve({ type: 'WORK' }),
  })
  expect(element.type).toBe(TimelineIndex)
  const result = await renderServerMarkup(await TimelineIndex(element.props))
  expect(result).toContain('2023 年')
  expect(result).toContain('<details')
  expect(result).toContain('完整职业故事')
  expect(result).toContain('/journey?type=WORK')
  expect(mocks.list.mock.calls.at(-1)?.[0].get('type')).toBe('WORK')
})
test('时间线不创建独立详情地址', async () => {
  mocks.module.mockResolvedValue({
    key: 'timeline',
    name: '职业故事',
    route: '/journey',
    config: {},
  })
  await expect(
    ContentPage({
      params: Promise.resolve({ path: ['journey', 'one'] }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow('NEXT_NOT_FOUND')
})
