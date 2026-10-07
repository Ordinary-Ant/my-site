import { test, expect } from 'vitest'
import * as routes from '@/lib/module-routing'
test('当前路径优先，全部历史直接到最新地址并保留详情后缀', () => {
  expect(routes.resolveModuleRedirect).toBeTypeOf('function')
  const modules = [{ key: 'article', route: '/writing' }],
    aliases = [
      { moduleKey: 'article', path: '/articles' },
      { moduleKey: 'article', path: '/notes' },
      { moduleKey: 'article', path: '/writing' },
    ]
  expect(routes.resolveModuleRedirect('/writing/abc', modules, aliases)).toBeNull()
  expect(routes.resolveModuleRedirect('/articles/abc', modules, aliases)).toBe('/writing/abc')
  expect(routes.resolveModuleRedirect('/notes', modules, aliases)).toBe('/writing')
  expect(routes.resolveModuleRedirect('/articles-extra', modules, aliases)).toBeNull()
})
