export type CategoryNode = {
  id: string
  name: string
  slug: string
  parentId: string | null
  order: number
  revision: number
  children: CategoryNode[]
  description?: string | null
  icon?: string | null
  color?: string | null
  articleCount?: number
  totalCount?: number
}
export type TagItem = {
  id: string
  name: string
  slug: string
  color: string | null
  revision: number
  counts: { article: number; log: number; project: number; total: number }
}
/** 搜索保留命中项的祖先，避免筛选结果失去层级语义。 */
export function filterCategoryTree<T extends CategoryNode>(tree: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return tree
  return tree.flatMap((node) => {
    const children = filterCategoryTree(node.children, q)
    return (node.name + ' ' + node.slug).toLowerCase().includes(q)
      ? [node]
      : children.length
        ? [{ ...node, children }]
        : []
  })
}
export function flattenCategories<T extends CategoryNode>(
  tree: T[],
  depth = 0,
): Array<T & { depth: number }> {
  return tree.flatMap((node) => [
    { ...node, depth },
    ...flattenCategories(node.children as T[], depth + 1),
  ])
}
/** 同父级可见条目复用原顺序槽位，不借重排改变分类层级或隐藏项。 */
export function categoryReorder(tree: CategoryNode[], source: string, target: string) {
  const all = flattenCategories(tree),
    from = all.find((node) => node.id === source),
    to = all.find((node) => node.id === target)
  if (!from || !to || from.parentId !== to.parentId || source === target) return []
  const group = all.filter((node) => node.parentId === from.parentId),
    slots = group.map((node) => node.order).sort((a, b) => a - b)
  for (let i = 1; i < slots.length; i++) slots[i] = Math.max(slots[i], slots[i - 1] + 1)
  if (slots.at(-1)! > 1_000_000) return []
  const start = group.findIndex((node) => node.id === source),
    end = group.findIndex((node) => node.id === target),
    moved = [...group]
  moved.splice(end, 0, ...moved.splice(start, 1))
  return moved.map((node, index) => ({ id: node.id, order: slots[index], revision: node.revision }))
}
export function tagSelectionQuery(current: string, patch: Record<string, string | null>) {
  const params = new URLSearchParams(current)
  if (!Object.hasOwn(patch, 'page')) params.delete('page')
  for (const [key, value] of Object.entries(patch))
    if (value == null || value === '') params.delete(key)
    else params.set(key, value)
  return params.toString()
}
import { z } from 'zod'
const draftString = z.string().max(4000)
export const taxonomyRecoverySchema = z
  .object({
    draft: z
      .object({
        name: draftString,
        slug: draftString,
        description: draftString,
        icon: draftString,
        color: draftString,
        parentId: draftString,
        order: draftString,
      })
      .strict(),
    editing: z
      .object({
        id: z.string().min(1).max(100),
        name: draftString,
        slug: draftString,
        revision: z.number().int().min(1),
        childCount: z.number().int().min(0).max(100000),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type TaxonomyRecovery = z.infer<typeof taxonomyRecoverySchema>
