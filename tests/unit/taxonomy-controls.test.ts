import { expect, test } from 'vitest'
import {
  filterCategoryTree,
  categoryReorder,
  flattenCategories,
  tagSelectionQuery,
  taxonomyRecoverySchema,
} from '@/lib/taxonomy-controls'
const tree = [
  {
    id: 'a',
    name: '技术',
    slug: 'tech',
    parentId: null,
    order: 0,
    revision: 1,
    children: [
      {
        id: 'aa',
        name: '前端',
        slug: 'frontend',
        parentId: 'a',
        order: 0,
        revision: 2,
        children: [],
      },
    ],
  },
  { id: 'b', name: '生活', slug: 'life', parentId: null, order: 1, revision: 1, children: [] },
]
test('分类搜索保留祖先但排除无关节点，展开树保留层级', () => {
  const result = filterCategoryTree(tree, '前端')
  expect(result.map((item) => item.id)).toEqual(['a'])
  expect(result[0].children.map((item) => item.id)).toEqual(['aa'])
  expect(flattenCategories(result).map((item) => [item.id, item.depth])).toEqual([
    ['a', 0],
    ['aa', 1],
  ])
})
test('本地分类标签稿保留未完成字段和原修订号，拒绝额外结构', () => {
  const value = {
    draft: {
      name: '',
      slug: '未完成slug',
      description: '',
      icon: '',
      color: '#待定',
      parentId: '',
      order: '',
    },
    editing: { id: 'tag-id', name: '旧标签', slug: 'old', revision: 3, childCount: 0 },
  }
  expect(taxonomyRecoverySchema.parse(value).editing?.revision).toBe(3)
  expect(taxonomyRecoverySchema.safeParse({ ...value, unexpected: true }).success).toBe(false)
  expect(
    taxonomyRecoverySchema.safeParse({ ...value, editing: { ...value.editing, revision: 0 } })
      .success,
  ).toBe(false)
})
test('分类只重排同父级当前树中的兄弟，保留修订号且拒绝越级', () => {
  expect(categoryReorder(tree, 'b', 'a')).toEqual([
    { id: 'b', order: 0, revision: 1 },
    { id: 'a', order: 1, revision: 1 },
  ])
  expect(categoryReorder(tree, 'aa', 'a')).toEqual([])
})
test('标签筛选重置页号且保留其他条件', () => {
  expect(tagSelectionQuery('q=React&sort=usage&page=3&pageSize=50', { sort: 'name' })).toBe(
    'q=React&sort=name&pageSize=50',
  )
})
