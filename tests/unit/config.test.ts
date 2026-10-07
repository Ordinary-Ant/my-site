import { expect, test } from 'vitest'
import { mergeKnownObjects, mergeModuleConfig, validateModuleRoute } from '@/lib/validators/module'
import { MODULE_REGISTRY } from '@/config/modules'

test('局部更新保留嵌套字段并允许清空导语', () => {
  const original = MODULE_REGISTRY.article.defaultConfig
  const merged = mergeModuleConfig('article', original, { home: { enabled: false }, intro: null })
  expect(merged.home).toEqual({ enabled: false, limit: 5, order: 3 })
  expect(merged.intro).toBeNull()
  expect(merged.pageSize).toBe(10)
  expect(original.home?.enabled).toBe(true)
})

test('拒绝未知键、原型污染及模块不支持的类型', () => {
  for (const patch of [
    { random: true },
    { home: { mystery: 1 } },
    { types: { GAME: true } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ]) {
    expect(() =>
      mergeModuleConfig('article', MODULE_REGISTRY.article.defaultConfig, patch),
    ).toThrow()
  }
})

test('栏目路由拒绝保留路由、冲突和嵌套', () => {
  for (const path of [
    '/admin/blog',
    '/api',
    '/',
    '/Articles',
    '/articles/',
    '/articles/x',
    '/old',
  ]) {
    expect(() =>
      validateModuleRoute(
        'article',
        path,
        [{ key: 'log', route: '/articles' }],
        [{ moduleKey: 'log', path: '/old' }],
      ),
    ).toThrow()
  }
  expect(
    validateModuleRoute('article', '/writing', [{ key: 'article', route: '/articles' }], []),
  ).toBe('/writing')
})

test('改名不能嵌套自身当前路径；数组整体替换不按索引合并', () => {
  expect(() =>
    validateModuleRoute(
      'article',
      '/articles/writing',
      [{ key: 'article', route: '/articles' }],
      [],
    ),
  ).toThrow()
  expect(
    mergeKnownObjects(
      { groups: ['one', 'two'], nested: { retained: 1, cleared: 'old' } },
      { groups: ['new'], nested: { cleared: null } },
    ),
  ).toEqual({ groups: ['new'], nested: { retained: 1, cleared: null } })
})
