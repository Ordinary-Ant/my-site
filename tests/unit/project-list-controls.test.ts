import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ProjectList } from '@/components/admin/project-list'
import {
  projectListQuery,
  selectProjectRange,
  remainingProjectSelection,
  projectReorder,
} from '@/lib/project-list-controls'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/projects',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams({
      view: 'grid',
      from: '2023-05-01',
      to: '2023-05-31',
      tag: 'existing',
      tech: 'React',
    }),
}))
let role = 'ADMIN'
vi.mock('@/components/admin/shell', () => ({
  useAdminUser: () => ({
    role,
    permissions: role === 'VIEWER' ? ['content:read'] : ['content:read', 'content:write'],
  }),
}))

test('作品筛选恢复URL日期标签技术栈，并提供网格与列偏好', () => {
  const html = renderToStaticMarkup(createElement(ProjectList))
  expect(html).toContain('aria-label="开始日期"')
  expect(html).toContain('value="2023-05-01"')
  expect(html).toContain('value="2023-05-31"')
  expect(html).toContain('aria-label="作品标签筛选"')
  expect(html).toContain('aria-label="技术栈筛选"')
  expect(html).toContain('value="React"')
  expect(html).toContain('列设置')
  expect(html).toContain('当前筛选页')
  expect(html).toContain('按自定义顺序')
})
test('只读用户没有新建作品入口', () => {
  role = 'VIEWER'
  expect(renderToStaticMarkup(createElement(ProjectList))).not.toContain('新建作品')
  role = 'ADMIN'
})
const rows = [
  { id: 'a', revision: 2, order: 10 },
  { id: 'b', revision: 3, order: 20 },
  { id: 'c', revision: 4, order: 30 },
]
test('Shift范围选择保存当前页修订号并保留其它页选择', () => {
  expect(selectProjectRange({ other: 8 }, rows, 2, true, 0)).toEqual({ other: 8, a: 2, b: 3, c: 4 })
  expect(selectProjectRange({ a: 2, other: 8 }, rows, 0, false, null)).toEqual({ other: 8 })
})
test('批量部分失败仅清除成功项，失败CAS修订号不会被刷新覆盖', () => {
  expect(remainingProjectSelection({ a: 2, b: 3 }, ['a'])).toEqual({ b: 3 })
})
test('当前页重排保留页排序槽位与revision，未传入其它页id', () => {
  expect(projectReorder(rows, 'c', 'a')).toEqual([
    { id: 'c', order: 10, revision: 4 },
    { id: 'a', order: 20, revision: 2 },
    { id: 'b', order: 30, revision: 3 },
  ])
  expect(projectReorder(rows, 'missing', 'a')).toEqual([])
  expect(projectReorder(rows, 'a', 'a')).toEqual([])
})
test('重复排序槽位重排时生成严格递增当前页顺序', () => {
  expect(
    projectReorder(
      rows.map((row) => ({ ...row, order: 0 })),
      'c',
      'a',
    ).map((row) => row.order),
  ).toEqual([0, 1, 2])
})

test('恢复视图偏好保留分享URL页码和筛选条件', () => {
  const next = projectListQuery('page=2&type=REPO&tech=React', { view: 'grid' })
  expect(next.get('page')).toBe('2')
  expect(next.get('view')).toBe('grid')
  expect(next.get('type')).toBe('REPO')
  expect(next.get('tech')).toBe('React')
})
test('纯视图切换保留当前页，筛选和每页条数变化仍回到第一页', () => {
  expect(projectListQuery('page=3&view=grid', { view: 'list' }).get('page')).toBe('3')
  expect(projectListQuery('page=3&view=grid', { type: 'GAME' }).has('page')).toBe(false)
  expect(projectListQuery('page=3&view=grid', { pageSize: '20' }).has('page')).toBe(false)
  expect(projectListQuery('page=3&view=grid', { sort: 'title:asc' }).has('page')).toBe(false)
  expect(projectListQuery('page=3&view=grid', { view: 'list', type: 'GAME' }).has('page')).toBe(
    false,
  )
  expect(projectListQuery('page=3&view=grid', { page: '4' }).get('page')).toBe('4')
})
