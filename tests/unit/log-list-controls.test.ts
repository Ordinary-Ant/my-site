import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LogList } from '@/components/admin/log-list'
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/logs',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () =>
    new URLSearchParams({ view: 'list', from: '2023-05-01', to: '2023-05-31', tag: 'existing' }),
}))
vi.mock('@/components/admin/shell', () => ({
  useAdminUser: () => ({ role: 'ADMIN', permissions: ['content:write'] }),
}))
vi.mock('@/components/admin/log-editor', () => ({ LogEditor: () => null }))
vi.mock('@/components/admin/dialog', () => ({ AdminDialog: () => null }))
test('日志日期范围有可访问标签并恢复URL值，标签筛选可见', () => {
  const html = renderToStaticMarkup(createElement(LogList))
  expect(html).toContain('aria-label="开始日期"')
  expect(html).toContain('value="2023-05-01"')
  expect(html).toContain('aria-label="结束日期"')
  expect(html).toContain('value="2023-05-31"')
  expect(html).toContain('aria-label="日志标签筛选"')
})
