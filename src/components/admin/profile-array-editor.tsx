'use client'
import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
function Row({
  id,
  disabled,
  title,
  children,
}: {
  id: string
  disabled: boolean
  title: string
  children: ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      className="rounded-lg border p-4"
      style={{
        transform: transform ? `translateY(${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={'拖拽排序 ' + title}
        className="mb-3 touch-none rounded border px-3 py-1"
      >
        ☰ 排序
      </button>
      {children}
    </div>
  )
}
/** 数组统一支持拖拽、键盘与上下移动；删除由父级保存撤销快照。 */
export function ProfileArrayEditor<T>({
  items,
  onChange,
  empty,
  label,
  disabled,
  render,
  onDelete,
}: {
  items: T[]
  onChange: (items: T[]) => void
  empty: () => T
  label: string
  disabled: boolean
  render: (item: T, index: number, update: (item: T) => void) => ReactNode
  onDelete: (index: number) => void
}) {
  const ids = items.map((_, index) => label + '-' + index),
    sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (disabled || !over || active.id === over.id) return
          const from = ids.indexOf(String(active.id)),
            to = ids.indexOf(String(over.id))
          if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to))
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {items.map((item, index) => (
              <Row
                key={ids[index]}
                id={ids[index]}
                disabled={disabled}
                title={label + ' ' + (index + 1)}
              >
                {render(
                  item,
                  index,
                  (next) =>
                    !disabled && onChange(items.map((value, i) => (i === index ? next : value))),
                )}
                <div className="mt-3 flex gap-4 text-sm">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    aria-label={'上移' + label + ' ' + (index + 1)}
                    onClick={() => !disabled && onChange(arrayMove(items, index, index - 1))}
                  >
                    ↑ 上移
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === items.length - 1}
                    aria-label={'下移' + label + ' ' + (index + 1)}
                    onClick={() => !disabled && onChange(arrayMove(items, index, index + 1))}
                  >
                    ↓ 下移
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={'删除' + label + ' ' + (index + 1)}
                    onClick={() => !disabled && onDelete(index)}
                    className="text-destructive"
                  >
                    删除
                  </button>
                </div>
              </Row>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        disabled={disabled || items.length >= 50}
        onClick={() => !disabled && onChange([...items, empty()])}
        className="rounded border px-3 py-2 text-sm"
      >
        添加{label}
      </button>
    </div>
  )
}
