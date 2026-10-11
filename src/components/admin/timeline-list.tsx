'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { api, ClientError } from '@/lib/api/client'
import { safeContentUrl } from '@/lib/markdown'
import { TIMELINE_TYPES, timelineDate, type TimelineItem } from '@/lib/timeline-display'
import {
  timelineListQuery,
  timelineNeighbor,
  timelinePermissions,
  timelineReorder,
} from '@/lib/timeline-list-controls'
import { useAdminUser } from './shell'

const control = 'rounded-lg border bg-background px-3 py-2 text-sm'
function SortableRow({
  row,
  disabled,
  showHandle,
  children,
}: {
  row: TimelineItem
  disabled: boolean
  showHandle: boolean
  children: ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({
    id: row.id,
    disabled,
  })
  return (
    <tr
      ref={setNodeRef}
      data-timeline-row
      tabIndex={0}
      className="focus:bg-muted"
      style={{
        transform: transform ? `translateY(${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {showHandle && (
        <td className="p-3">
          <button
            type="button"
            disabled={disabled}
            {...attributes}
            {...listeners}
            aria-label={'拖拽排序 ' + row.title}
            className="touch-none rounded border p-2"
          >
            ☰
          </button>
        </td>
      )}
      {children}
    </tr>
  )
}
/** 列表与回收站共享入口；请求完成前不展示旧页，写入始终携带CAS修订号。 */
export function TimelineList({ trash = false }: { trash?: boolean }) {
  const user = useAdminUser(),
    { writable, purge } = timelinePermissions(user)
  const params = useSearchParams(),
    query = params.toString(),
    path = usePathname(),
    router = useRouter()
  const [search, setSearch] = useState(params.get('q') ?? ''),
    [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<{
    rows: TimelineItem[]
    total: number
    pages: number
    key: string
  }>({ rows: [], total: 0, pages: 1, key: '' })
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const mutation = useRef(false),
    currentKey = useRef(''),
    searchInput = useRef<HTMLInputElement>(null)
  const key = `${trash}:${query}:${refresh}`
  currentKey.current = key
  const ready = data.key === key,
    rows = ready ? data.rows : [],
    page = Number(params.get('page')) || 1
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const navigate = (patch: Record<string, string | null>) =>
    router.replace(path + '?' + timelineListQuery(query, patch))
  useEffect(() => {
    setSearch(params.get('q') ?? '')
    setMessage('')
  }, [query, trash]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (search === (params.get('q') ?? '')) return
    const timer = setTimeout(() => navigate({ q: search }), 300)
    return () => clearTimeout(timer)
  }, [search, query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    setError('')
    const request = new URLSearchParams()
    for (const name of ['type', 'q', 'page', 'pageSize'])
      if (params.get(name)) request.set(name, params.get(name)!)
    if (trash) request.set('deleted', 'true')
    void api<TimelineItem[]>('/api/v1/admin/timeline?' + request)
      .then((result) => {
        if (active && currentKey.current === key)
          setData({
            rows: result.data,
            total: result.meta?.total ?? result.data.length,
            pages: Math.max(1, result.meta?.totalPages ?? 1),
            key,
          })
      })
      .catch((failure: Error) => {
        if (active && currentKey.current === key) setError(failure.message)
      })
    return () => {
      active = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (request: () => Promise<unknown>, rollback?: () => void) => {
    if (mutation.current || !ready || !writable) return
    mutation.current = true
    setBusy(true)
    setMessage('')
    const started = key
    try {
      await request()
      if (currentKey.current === started) {
        setMessage('已保存')
        setRefresh((value) => value + 1)
      } else setRefresh((value) => value + 1)
    } catch (failure) {
      if (currentKey.current === started) {
        rollback?.()
        setMessage(
          failure instanceof ClientError && failure.status === 409
            ? '条目已被他人修改，请刷新列表后重试。'
            : (failure as Error).message,
        )
      }
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  const act = (row: TimelineItem, action: 'delete' | 'restore' | 'purge') => {
    if (!writable || (action === 'purge' && !purge) || mutation.current) return
    if (
      action === 'purge'
        ? prompt('彻底删除不可恢复，请输入标题：' + row.title) !== row.title
        : !confirm(action === 'restore' ? '恢复这条经历？' : '将这条经历移入回收站？')
    )
      return
    void run(() =>
      api('/api/v1/admin/timeline/' + row.id + (action === 'delete' ? '' : '/' + action), {
        method: action === 'restore' ? 'POST' : 'DELETE',
        body: JSON.stringify({ revision: row.revision }),
      }),
    )
  }
  const move = (source: string, target: string) => {
    if (trash || !writable || mutation.current || !ready) return
    const items = timelineReorder(rows, source, target)
    if (!items.length) {
      setMessage('只能在当前筛选页内、同一开始日期且当前状态相同的条目之间排序。')
      return
    }
    const previous = data
    const group = new Set(items.map((item) => item.id))
    let index = 0
    setData({
      ...data,
      rows: rows.map((row) => {
        if (!group.has(row.id)) return row
        const item = items[index++]
        return { ...rows.find((entry) => entry.id === item.id)!, order: item.order }
      }),
    })
    void run(
      () =>
        api('/api/v1/admin/timeline/reorder', { method: 'PATCH', body: JSON.stringify({ items }) }),
      () => setData(previous),
    )
  }
  const visibility = (row: TimelineItem, field: 'visible' | 'showOnAbout') =>
    !writable || trash ? (
      <span>{row[field] ? '显示' : '隐藏'}</span>
    ) : (
      <input
        type="checkbox"
        aria-label={(field === 'visible' ? '时间戳页显示 ' : '关于我页显示 ') + row.title}
        checked={row[field]}
        disabled={!writable || trash || busy || (field === 'showOnAbout' && row.type !== 'WORK')}
        onChange={(event) => {
          const checked = event.target.checked
          void run(() =>
            api('/api/v1/admin/timeline/' + row.id, {
              method: 'PATCH',
              body: JSON.stringify({ [field]: checked, revision: row.revision }),
            }),
          )
        }}
      />
    )
  const actions = (row: TimelineItem) => (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={'/admin/timeline/' + row.id}>{writable && !trash ? '编辑' : '查看'}</Link>
      {writable && !trash && (
        <>
          <Link href={'/admin/timeline/new?copy=' + row.id}>复制</Link>
          <button type="button" disabled={busy} onClick={() => act(row, 'delete')}>
            删除
          </button>
        </>
      )}
      {writable && trash && (
        <button type="button" disabled={busy} onClick={() => act(row, 'restore')}>
          恢复
        </button>
      )}
      {purge && trash && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(row, 'purge')}
          className="text-destructive"
        >
          彻底删除
        </button>
      )}
      {writable &&
        !trash &&
        [-1, 1].map((direction) => {
          const target = timelineNeighbor(rows, row.id, direction as -1 | 1)
          return (
            <button
              type="button"
              key={direction}
              disabled={busy || !target}
              aria-label={(direction === -1 ? '上移 ' : '下移 ') + row.title}
              onClick={() => target && move(row.id, target)}
            >
              {direction === -1 ? '↑' : '↓'}
            </button>
          )
        })}
    </div>
  )
  const identity = (row: TimelineItem) => {
    const logo = row.logo ? safeContentUrl(row.logo) : null
    return (
      <div className="flex items-center gap-3">
        {logo && (
          <Image
            src={logo}
            alt={row.organization ?? ''}
            width={32}
            height={32}
            unoptimized
            className="size-8 rounded object-contain"
          />
        )}
        <div>
          <Link className="font-medium" href={'/admin/timeline/' + row.id}>
            {row.title}
          </Link>
          <p className="text-muted-foreground">
            {[row.organization, row.location].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
    )
  }
  const date = (row: TimelineItem) => (
    <>
      {timelineDate(row.startDate, row.startPrecision)} —{' '}
      {row.isCurrent
        ? '至今 · 进行中'
        : row.endDate
          ? timelineDate(row.endDate, row.endPrecision)
          : '未填写结束日期'}
    </>
  )
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{trash ? '时间戳回收站' : '时间戳管理'}</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href={trash ? '/admin/timeline' : '/admin/timeline/trash'}>
            {trash ? '返回列表' : '回收站'}
          </Link>
          {writable && !trash && (
            <Link
              href="/admin/timeline/new"
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
            >
              新建条目
            </Link>
          )}
        </div>
      </header>
      {!writable && <p className="mt-3 text-sm">只读：可查看条目，不能修改。</p>}
      <div className="my-6 flex flex-wrap gap-3">
        <input
          ref={searchInput}
          className={control + ' min-w-0 flex-1'}
          aria-label="筛选时间戳"
          placeholder="搜索标题、机构或地点"
          maxLength={200}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={control}
          aria-label="时间戳类型筛选"
          value={params.get('type') ?? ''}
          onChange={(event) => navigate({ type: event.target.value })}
        >
          <option value="">全部类型</option>
          {Object.entries(TIMELINE_TYPES).map(([value, kind]) => (
            <option key={value} value={value}>
              {kind.label}
            </option>
          ))}
        </select>
        <select
          className={control}
          aria-label="每页条数"
          value={params.get('pageSize') ?? '20'}
          onChange={(event) => navigate({ pageSize: event.target.value })}
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}条
            </option>
          ))}
        </select>
        <button type="button" className={control} onClick={() => router.replace(path)}>
          重置
        </button>
      </div>
      <p className="text-muted-foreground mb-3 text-sm">
        时间戳页与关于我页独立显示；关于我页仅工作类型生效。排序仅限当前筛选页中同一开始日期、同一当前状态的条目，不会改变日期优先级。
      </p>
      {writable && !trash && (
        <p className="text-muted-foreground mb-3 text-sm">
          拖拽手柄，或聚焦手柄后按空格、方向键、空格完成排序；移动端可用上下按钮。跨页或被筛选隐藏的条目不会写入。
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4">
          {error}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            重试读取
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="mb-4">
          {message}
          <button
            type="button"
            disabled={busy}
            className="ml-3 underline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            刷新列表
          </button>
        </p>
      )}
      {ready && rows.filter((row) => row.isCurrent).length > 1 && (
        <p role="status" className="mb-3 text-sm">
          提示：当前页有多条进行中经历，请确认是否符合实际情况。
        </p>
      )}
      {!ready && !error ? (
        <p role="status">正在加载时间戳…</p>
      ) : (
        ready && (
          <>
            <p className="mb-3 text-sm">
              共 {data.total} 条 · 当前页 {rows.length} 条
            </p>
            {!rows.length ? (
              <p className="rounded-xl border p-8 text-center">
                {trash ? '回收站为空' : '没有符合筛选条件的条目'}
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border md:block">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={({ active, over }) => {
                      if (over && active.id !== over.id) move(String(active.id), String(over.id))
                    }}
                  >
                    <SortableContext
                      items={rows.map((row) => row.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <table
                        className="w-full text-left text-sm"
                        onKeyDown={(event) => {
                          if (
                            !(event.target instanceof HTMLElement) ||
                            event.target.closest('input,select,textarea,button,a')
                          )
                            return
                          const row = event.target.closest('tr[data-timeline-row]'),
                            all = Array.from(
                              event.currentTarget.querySelectorAll<HTMLTableRowElement>(
                                'tr[data-timeline-row]',
                              ),
                            ),
                            index = all.indexOf(row as HTMLTableRowElement)
                          if (event.key === 'j' || event.key === 'k') {
                            event.preventDefault()
                            all[
                              Math.max(
                                0,
                                Math.min(all.length - 1, index + (event.key === 'j' ? 1 : -1)),
                              )
                            ]?.focus()
                          }
                          if (event.key === '/') {
                            event.preventDefault()
                            searchInput.current?.focus()
                          }
                          if (event.key === 'Enter' && index >= 0)
                            router.push('/admin/timeline/' + rows[index].id)
                        }}
                      >
                        <thead className="bg-muted">
                          <tr>
                            {writable && !trash && <th className="p-3">排序</th>}
                            <th className="p-3">标题 / 机构</th>
                            <th className="p-3">类型</th>
                            <th className="p-3">日期</th>
                            <th className="p-3">时间戳页</th>
                            <th className="p-3">关于我页</th>
                            <th className="p-3">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map((row) => (
                            <SortableRow
                              key={row.id}
                              row={row}
                              showHandle={writable && !trash}
                              disabled={!writable || trash || busy}
                            >
                              <td className="p-3">{identity(row)}</td>
                              <td className="p-3">
                                {TIMELINE_TYPES[row.type].icon} {TIMELINE_TYPES[row.type].label}
                              </td>
                              <td className="p-3 whitespace-nowrap">{date(row)}</td>
                              <td className="p-3">{visibility(row, 'visible')}</td>
                              <td className="p-3">
                                {row.type === 'WORK' ? visibility(row, 'showOnAbout') : '不适用'}
                              </td>
                              <td className="p-3">{actions(row)}</td>
                            </SortableRow>
                          ))}
                        </tbody>
                      </table>
                    </SortableContext>
                  </DndContext>
                </div>
                <div className="space-y-3 md:hidden">
                  {rows.map((row) => (
                    <article className="rounded-xl border p-4" key={row.id}>
                      {identity(row)}
                      <p className="my-3 text-sm">
                        {TIMELINE_TYPES[row.type].label} · {date(row)}
                      </p>
                      <div className="mb-4 flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          {visibility(row, 'visible')}时间戳页
                        </label>
                        {row.type === 'WORK' ? (
                          <label className="flex items-center gap-2">
                            {visibility(row, 'showOnAbout')}关于我页
                          </label>
                        ) : (
                          <span>关于我页：不适用</span>
                        )}
                      </div>
                      {actions(row)}
                    </article>
                  ))}
                </div>
              </>
            )}
            <nav aria-label="时间戳分页" className="mt-6 flex items-center gap-4">
              <button
                type="button"
                className={control}
                disabled={page <= 1 || busy}
                onClick={() => navigate({ page: String(page - 1) })}
              >
                上一页
              </button>
              <span className="text-sm">
                第 {page} / {data.pages} 页
              </span>
              <button
                type="button"
                className={control}
                disabled={page >= data.pages || busy}
                onClick={() => navigate({ page: String(page + 1) })}
              >
                下一页
              </button>
            </nav>
          </>
        )
      )}
    </div>
  )
}
