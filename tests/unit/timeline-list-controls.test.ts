import { expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TimelineList } from '@/components/admin/timeline-list'
import {
  timelineReorder,
  timelineNeighbor,
  timelineListQuery,
  timelinePermissions,
} from '@/lib/timeline-list-controls'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/timeline',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('type=WORK&q=工程&page=2'),
}))
let role = 'ADMIN'
vi.mock('@/components/admin/shell', () => ({
  useAdminUser: () => ({
    role,
    permissions: role === 'VIEWER' ? ['content:read'] : ['content:read', 'content:write'],
  }),
}))
const rows = [
  { id: 'a', startDate: '2025-01-01T00:00:00.000Z', isCurrent: true, order: 5, revision: 2 },
  { id: 'b', startDate: '2025-01-01T00:00:00.000Z', isCurrent: true, order: 10, revision: 3 },
  { id: 'c', startDate: '2024-01-01T00:00:00.000Z', isCurrent: true, order: 0, revision: 4 },
  { id: 'd', startDate: '2025-01-01T00:00:00.000Z', isCurrent: false, order: 0, revision: 5 },
]
test('同日期同当前组重排仅提交该组当前页项和原修订号', () => {
  expect(timelineReorder(rows, 'b', 'a')).toEqual([
    { id: 'b', order: 5, revision: 3 },
    { id: 'a', order: 10, revision: 2 },
  ])
})
test('不能跨日期或当前状态重排', () => {
  expect(timelineReorder(rows, 'a', 'c')).toEqual([])
  expect(timelineReorder(rows, 'a', 'd')).toEqual([])
})
test('无效项与相同项不触发重排', () => {
  expect(timelineReorder(rows, 'a', 'a')).toEqual([])
  expect(timelineReorder(rows, 'missing', 'a')).toEqual([])
})
test('重复order产生严格递增槽位，保持组外项不变', () => {
  expect(
    timelineReorder(
      rows.map((row) => ({ ...row, order: 0 })),
      'b',
      'a',
    ),
  ).toEqual([
    { id: 'b', order: 0, revision: 3 },
    { id: 'a', order: 1, revision: 2 },
  ])
})
test('键盘移动邻项限制为同组', () => {
  expect(timelineNeighbor(rows, 'a', 1)).toBe('b')
  expect(timelineNeighbor(rows, 'b', 1)).toBeNull()
  expect(timelineNeighbor(rows, 'a', -1)).toBeNull()
})
test('筛选变化回首页，翻页保留筛选', () => {
  expect(timelineListQuery('type=WORK&page=2', { q: '经理' }).has('page')).toBe(false)
  expect(timelineListQuery('type=WORK&page=2', { page: '3' }).toString()).toBe('type=WORK&page=3')
})
test('查看权限不授予写入，彻底删除仅管理员', () => {
  expect(timelinePermissions({ role: 'VIEWER', permissions: ['content:read'] })).toEqual({
    writable: false,
    purge: false,
  })
  expect(timelinePermissions({ role: 'EDITOR', permissions: ['content:write'] })).toEqual({
    writable: true,
    purge: false,
  })
  expect(timelinePermissions({ role: 'ADMIN', permissions: ['content:write'] })).toEqual({
    writable: true,
    purge: true,
  })
})
test('列表恢复筛选且呈现排序和独立可见性解释', () => {
  const html = renderToStaticMarkup(createElement(TimelineList))
  expect(html).toContain('value="工程"')
  expect(html).toContain('同一开始日期')
  expect(html).toContain('关于我页')
  expect(html).toContain('新建条目')
})
test('只读用户没有创建入口与排序写控', () => {
  role = 'VIEWER'
  const html = renderToStaticMarkup(createElement(TimelineList))
  expect(html).not.toContain('新建条目')
  expect(html).toContain('只读')
  role = 'ADMIN'
})
