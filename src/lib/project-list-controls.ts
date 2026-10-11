type Item = { id: string; revision: number; order: number }
export function projectListQuery(query: string, patch: Record<string, string | null>) {
  const next = new URLSearchParams(query)
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key)
    else next.set(key, value)
  }
  // 视图只改变呈现，偏好恢复与切换均保留当前数据页。
  if (!Object.hasOwn(patch, 'page') && Object.keys(patch).some((key) => key !== 'view'))
    next.delete('page')
  return next
}
export function selectProjectRange(
  selected: Record<string, number>,
  rows: Item[],
  index: number,
  checked: boolean,
  anchor: number | null,
) {
  const next = { ...selected }
  const entries =
    anchor !== null && anchor >= 0 && anchor < rows.length
      ? rows.slice(Math.min(index, anchor), Math.max(index, anchor) + 1)
      : [rows[index]]
  for (const row of entries.filter(Boolean)) {
    if (checked) next[row.id] = row.revision
    else delete next[row.id]
  }
  return next
}
export function remainingProjectSelection(selected: Record<string, number>, succeeded: string[]) {
  return Object.fromEntries(Object.entries(selected).filter(([id]) => !succeeded.includes(id)))
}
/** 仅使用当前页id和修订号，不生成未读取作品的写入。重复槽位按页内递增。 */
export function projectReorder(rows: Item[], from: string, to: string): Item[] {
  const source = rows.findIndex((row) => row.id === from),
    target = rows.findIndex((row) => row.id === to)
  if (source < 0 || target < 0 || source === target) return []
  const next = [...rows],
    [moved] = next.splice(source, 1)
  next.splice(target, 0, moved)
  const slots = rows.map((row) => row.order).sort((a, b) => a - b)
  for (let i = 1; i < slots.length; i++) slots[i] = Math.max(slots[i], slots[i - 1] + 1)
  if (slots.at(-1)! > 1_000_000) throw new Error('排序值超过上限，请先调整作品排序值')
  return next.map((row, index) => ({ id: row.id, revision: row.revision, order: slots[index] }))
}
