type OrderedItem = {
  id: string
  startDate: string | Date
  isCurrent: boolean
  order: number
  revision: number
}
const day = (item: OrderedItem) =>
  (item.startDate instanceof Date ? item.startDate.toISOString() : item.startDate).slice(0, 10)
const sameGroup = (a: OrderedItem, b: OrderedItem) =>
  a.isCurrent === b.isCurrent && day(a) === day(b)
/** 只提交当前筛选页可见的同日期组，保留原有槽位和CAS修订号。 */
export function timelineReorder(rows: OrderedItem[], source: string, target: string) {
  const from = rows.find((row) => row.id === source),
    to = rows.find((row) => row.id === target)
  if (!from || !to || source === target || !sameGroup(from, to)) return []
  const group = rows.filter((row) => sameGroup(row, from))
  const slots = group.map((row) => row.order).sort((a, b) => a - b)
  for (let i = 1; i < slots.length; i++) slots[i] = Math.max(slots[i], slots[i - 1] + 1)
  if (slots.at(-1)! > 1_000_000) return []
  const moved = [...group]
  moved.splice(
    group.findIndex((row) => row.id === source),
    1,
  )
  moved.splice(
    group.findIndex((row) => row.id === target),
    0,
    from,
  )
  return moved.map((row, index) => ({ id: row.id, order: slots[index], revision: row.revision }))
}
export function timelineNeighbor(rows: OrderedItem[], id: string, direction: -1 | 1) {
  const index = rows.findIndex((row) => row.id === id),
    next = rows[index + direction]
  return index >= 0 && next && sameGroup(rows[index], next) ? next.id : null
}
export function timelineListQuery(query: string, patch: Record<string, string | null>) {
  const next = new URLSearchParams(query)
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key)
    else next.set(key, value)
  }
  if (!Object.hasOwn(patch, 'page')) next.delete('page')
  return next
}
export function timelinePermissions(user: { role: string; permissions: string[] } | null) {
  const writable = !!user?.permissions.includes('content:write')
  return { writable, purge: writable && user?.role === 'ADMIN' }
}
