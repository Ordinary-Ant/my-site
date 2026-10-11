'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { pinyin } from 'pinyin-pro'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { api, ClientError } from '@/lib/api/client'
import {
  categoryReorder,
  filterCategoryTree,
  flattenCategories,
  tagSelectionQuery,
  type CategoryNode,
  type TagItem,
  taxonomyRecoverySchema,
  type TaxonomyRecovery,
} from '@/lib/taxonomy-controls'
import { ProfileIconPicker } from './profile-icons'
import { useAdminUser } from './shell'
const control =
  'mt-2 w-full rounded-lg border bg-background px-3 py-2 aria-invalid:border-destructive'
type Draft = {
  name: string
  slug: string
  description: string
  icon: string
  color: string
  parentId: string
  order: string
}
const empty = (): Draft => ({
  name: '',
  slug: '',
  description: '',
  icon: '',
  color: '',
  parentId: '',
  order: '0',
})
const draftFrom = (item: CategoryNode | TagItem): Draft => ({
  name: item.name,
  slug: item.slug,
  description: 'description' in item ? (item.description ?? '') : '',
  icon: 'icon' in item ? (item.icon ?? '') : '',
  color: item.color ?? '',
  parentId: 'parentId' in item ? (item.parentId ?? '') : '',
  order: 'order' in item ? String(item.order) : '0',
})
type Counts = { article: number; log: number; project: number; total: number }
type MergePreview = { target: TagItem; sources: TagItem[]; affected: Counts; additions: Counts }
function SortableCategory({
  item,
  disabled,
  children,
}: {
  item: CategoryNode
  disabled: boolean
  children: ReactNode
}) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useSortable({
    id: item.id,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      className="rounded-lg border p-3"
      style={{
        transform: transform ? `translateY(${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {!disabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={'拖拽分类 ' + item.name}
          className="mr-2 touch-none rounded border px-2 py-1"
        >
          ☰
        </button>
      )}
      {children}
    </div>
  )
}
/** 分类与标签的所有管理写入携带修订号；未保存表单不会被列表刷新静默覆盖。 */
export function TaxonomyManager({ kind }: { kind: 'categories' | 'tags' }) {
  const user = useAdminUser(),
    writable = !!user && user.role !== 'VIEWER',
    isCategory = kind === 'categories',
    label = isCategory ? '分类' : '标签',
    endpoint = '/api/v1/admin/' + kind,
    params = useSearchParams(),
    query = params.toString(),
    router = useRouter(),
    path = usePathname()
  const [refresh, setRefresh] = useState(0),
    [data, setData] = useState<{
      key: string
      rows: (CategoryNode | TagItem)[]
      total: number
      pages: number
    }>({ key: '', rows: [], total: 0, pages: 1 }),
    [search, setSearch] = useState(params.get('q') ?? ''),
    [view, setView] = useState<'table' | 'cloud'>('table'),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [selected, setSelected] = useState<Map<string, number>>(new Map()),
    [editing, setEditing] = useState<TaxonomyRecovery['editing']>(null),
    [recovery, setRecovery] = useState<TaxonomyRecovery | null>(null),
    [draft, setDraft] = useState<Draft>(empty),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>([])
  const current = useRef(draft),
    saved = useRef(JSON.stringify(draft)),
    mutation = useRef(false),
    manualSlug = useRef(false),
    currentKey = useRef(''),
    formRef = useRef<HTMLFormElement>(null),
    expandedOnce = useRef(false)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const localKey = 'taxonomy-draft:' + kind + ':' + (user?.id ?? '')
  const localWrites = useRef(new Set<string>())
  current.current = draft
  const key = kind + ':' + query + ':' + refresh,
    ready = data.key === key,
    rows = ready ? data.rows : [],
    tree = rows as CategoryNode[],
    tags = rows as TagItem[],
    flat = isCategory ? flattenCategories(tree) : [],
    filtered = isCategory ? filterCategoryTree(tree, params.get('q') ?? '') : [],
    page = Number(params.get('page')) || 1
  currentKey.current = key
  // 键盘和指针仅命中同父分类，子项不能截断根分类之间的移动。
  const sameParent = (source: string, destination: string) =>
    flat.find((item) => item.id === source)?.parentId ===
    flat.find((item) => item.id === destination)?.parentId
  const categoryCoordinates: KeyboardCoordinateGetter = (event, args) =>
    sortableKeyboardCoordinates(event, {
      ...args,
      context: {
        ...args.context,
        droppableRects: new Map(
          [...args.context.droppableRects].filter(([id]) =>
            sameParent(String(args.active), String(id)),
          ),
        ),
      },
    })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: categoryCoordinates }),
  )
  const [mergeOpen, setMergeOpen] = useState(false),
    [targetQuery, setTargetQuery] = useState(''),
    [targets, setTargets] = useState<TagItem[]>([]),
    [target, setTarget] = useState<TagItem | null>(null),
    [sources, setSources] = useState<TagItem[]>([]),
    [preview, setPreview] = useState<MergePreview | null>(null),
    [mergeLoading, setMergeLoading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null),
    previewSequence = useRef(0)
  const navigate = (patch: Record<string, string | null>) =>
    router.replace(path + '?' + tagSelectionQuery(query, patch))
  useEffect(() => {
    setSearch(params.get('q') ?? '')
    setSelected(new Map())
    setMessage('')
  }, [query, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (search === (params.get('q') ?? '')) return
    const timer = setTimeout(() => navigate({ q: search }), 300)
    return () => clearTimeout(timer)
  }, [search, query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    setError('')
    const request = new URLSearchParams()
    if (!isCategory)
      for (const name of ['q', 'sort', 'page', 'pageSize'])
        if (params.get(name)) request.set(name, params.get(name)!)
    void api<(CategoryNode | TagItem)[]>(endpoint + (request.size ? '?' + request : ''))
      .then((result) => {
        if (!active || currentKey.current !== key) return
        setData({
          key,
          rows: result.data,
          total: result.meta?.total ?? result.data.length,
          pages: Math.max(1, result.meta?.totalPages ?? 1),
        })
        if (!isCategory && page > Math.max(1, result.meta?.totalPages ?? 1))
          navigate({ page: String(Math.max(1, result.meta?.totalPages ?? 1)) })
        if (isCategory && !expandedOnce.current) {
          setExpanded(new Set(result.data.map((item) => item.id)))
          expandedOnce.current = true
        }
      })
      .catch((failure: Error) => active && currentKey.current === key && setError(failure.message))
    return () => {
      active = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing || manualSlug.current || !writable) return
    const timer = setTimeout(() => {
      if (manualSlug.current) return
      setDraft((value) => ({
        ...value,
        slug: pinyin(value.name, { toneType: 'none', type: 'array' })
          .join('-')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 200),
      }))
    }, 300)
    return () => clearTimeout(timer)
  }, [draft.name, editing, writable])
  const dirty = useCallback(() => JSON.stringify(current.current) !== saved.current, [])
  const keepLocal = useCallback(() => {
    if (!user?.id || !writable) return
    try {
      if (!dirty()) {
        // 仅清理本次编辑写入的稿，不能删掉首次载入等待恢复的旧稿。
        if (localWrites.current.delete(localKey)) sessionStorage.removeItem(localKey)
        return
      }
      sessionStorage.setItem(
        localKey,
        JSON.stringify({ draft: current.current, editing: editingRef.current }),
      )
      localWrites.current.add(localKey)
    } catch {}
  }, [user?.id, writable, dirty, localKey])
  const clearLocal = () => {
    try {
      sessionStorage.removeItem(localKey)
      localWrites.current.delete(localKey)
    } catch {}
    setRecovery(null)
  }
  useEffect(() => {
    if (!user || !writable) return
    try {
      const stored = sessionStorage.getItem(localKey)
      if (stored) {
        const parsed = taxonomyRecoverySchema.safeParse(JSON.parse(stored))
        if (parsed.success) setRecovery(parsed.data)
      }
    } catch {}
    return () => keepLocal()
  }, [localKey, writable]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    keepLocal()
  }, [draft, editing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        keepLocal()
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const click = (event: MouseEvent) => {
      if (
        (event.target as HTMLElement).closest?.('a[href]') &&
        dirty() &&
        !confirm('还有未保存的' + label + '修改，确定离开？')
      )
        event.preventDefault()
    }
    const back = (event: PopStateEvent) => {
      if (!dirty() || confirm('还有未保存的' + label + '修改，确定离开？')) return
      // 在Next处理历史导航前取消离开，恢复当前地址和其路由状态。
      event.stopImmediatePropagation()
      history.pushState(routeState, '', routeUrl)
    }
    const routeUrl = location.href
    const routeState = history.state
    // 支持Navigation API的浏览器会在Next历史监听器卸载表单前触发此事件。
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const traversing = (event: Event) => {
      const traversal = event as Event & { navigationType?: string }
      if (traversal.navigationType !== 'traverse' || !event.cancelable || !dirty()) return
      if (!confirm('还有未保存的' + label + '修改，确定离开？')) event.preventDefault()
    }
    navigation?.addEventListener('navigate', traversing)
    window.addEventListener('beforeunload', unload)
    window.addEventListener('popstate', back, true)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('popstate', back, true)
      navigation?.removeEventListener('navigate', traversing)
      document.removeEventListener('click', click, true)
    }
  }, [label, query, keepLocal, dirty])
  const choose = (item: CategoryNode | TagItem | null) => {
    if (mutation.current) return
    if (dirty() && !confirm('放弃尚未保存的' + label + '修改？')) return
    const next = item ? draftFrom(item) : empty()
    manualSlug.current = !!item
    setEditing(
      item
        ? {
            id: item.id,
            name: item.name,
            slug: item.slug,
            revision: item.revision,
            childCount: 'children' in item ? item.children.length : 0,
          }
        : null,
    )
    current.current = next
    setDraft(next)
    saved.current = JSON.stringify(next)
    clearLocal()
    setFieldErrors([])
    setError('')
  }
  const setField = (name: keyof Draft, value: string) => {
    if (!writable || mutation.current) return
    if (name === 'slug') manualSlug.current = true
    const next = { ...current.current, [name]: value }
    current.current = next
    setDraft(next)
    setFieldErrors([])
  }
  const run = async (action: () => Promise<void>) => {
    if (!ready || !writable || mutation.current) return
    mutation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setRefresh((value) => value + 1)
      setSelected(new Map())
    } catch (failure) {
      setError(
        failure instanceof ClientError && failure.status === 409 && failure.code !== 'SLUG_CONFLICT'
          ? '版本冲突：已保留当前表单和选择，请刷新比较后重试。'
          : (failure as Error).message,
      )
      if (failure instanceof ClientError && failure.details) setFieldErrors(failure.details)
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  const save = () => {
    const value = current.current
    if (!value.name.trim() || (!editing && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug))) {
      setError('请填写名称及合法slug。')
      formRef.current
        ?.querySelector<HTMLInputElement>('[name="' + (!value.name.trim() ? 'name' : 'slug') + '"]')
        ?.focus()
      return
    }
    const body = {
      name: value.name,
      ...(!editing || isCategory ? { slug: value.slug } : {}),
      color: value.color || null,
      ...(isCategory
        ? {
            description: value.description || null,
            icon: value.icon || null,
            parentId: value.parentId || null,
            order: Number(value.order),
          }
        : {}),
      ...(editing ? { revision: editing.revision } : {}),
    }
    void run(async () => {
      const result = await api<CategoryNode | TagItem>(
        endpoint + (editing ? '/' + editing.id : ''),
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      )
      const next = draftFrom(result.data)
      setEditing({
        id: result.data.id,
        name: result.data.name,
        slug: result.data.slug,
        revision: result.data.revision,
        childCount: isCategory
          ? (flat.find((item) => item.id === result.data.id)?.children.length ?? 0)
          : 0,
      })
      current.current = next
      setDraft(next)
      saved.current = JSON.stringify(next)
      clearLocal()
      setMessage(label + '已保存。')
    })
  }
  const remove = (item: CategoryNode | TagItem) => {
    if (!writable || mutation.current) return
    if (
      !confirm(
        isCategory
          ? '删除分类“' + item.name + '”？关联文章将变为未分类，正文保留。'
          : '删除标签“' + item.name + '”？只解除关联，不删除文章、日志或作品。',
      )
    )
      return
    void run(async () => {
      await api(endpoint + '/' + item.id, {
        method: 'DELETE',
        body: JSON.stringify({ revision: item.revision }),
      })
      setMessage(label + '已删除，内容保留。' + detachDeleted([item.id]))
    })
  }
  // 关系操作删除当前编辑项时，脏稿转为新建，不能继续向已删除ID保存。
  const detachDeleted = (ids: string[]) => {
    if (!editingRef.current || !ids.includes(editingRef.current.id)) return ''
    const keep = dirty()
    editingRef.current = null
    setEditing(null)
    clearLocal()
    saved.current = JSON.stringify(empty())
    manualSlug.current = keep
    if (!keep) {
      current.current = empty()
      setDraft(current.current)
    }
    return keep ? '当前编辑项已删除；未保存表单保留为新建，保存将创建新记录。' : ''
  }
  const move = (source: string, destination: string) => {
    const items = categoryReorder(filtered, source, destination)
    if (!items.length) {
      setMessage('只能在当前筛选结果的同父级分类中排序。')
      return
    }
    void run(async () => {
      await api(endpoint + '/reorder', { method: 'PATCH', body: JSON.stringify({ items }) })
      setMessage('分类顺序已保存。')
    })
  }
  useEffect(() => {
    if (!mergeOpen) return
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [mergeOpen])
  useEffect(() => {
    if (!mergeOpen) return
    let active = true
    const timer = setTimeout(() => {
      void api<TagItem[]>(
        '/api/v1/admin/tags?q=' + encodeURIComponent(targetQuery) + '&sort=name&pageSize=100',
      )
        .then((result) => active && setTargets(result.data))
        .catch((failure: Error) => active && setError(failure.message))
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [mergeOpen, targetQuery])
  const openMerge = () => {
    if (!writable || mutation.current || selected.size < 1) return
    const selectedRows = tags
      .filter((item) => selected.has(item.id))
      .map((item) => ({ ...item, revision: selected.get(item.id)! }))
    previewSequence.current++
    setMergeLoading(false)
    setSources(selectedRows)
    setTarget(null)
    setTargets([])
    setTargetQuery('')
    setPreview(null)
    setError('')
    setMergeOpen(true)
  }
  const mergeBody = () => ({
    target: target ? { id: target.id, revision: target.revision } : null,
    sources: sources
      .filter((item) => item.id !== target?.id)
      .map((item) => ({ id: item.id, revision: item.revision })),
  })
  const mergePreview = async () => {
    if (!target || mergeBody().sources.length === 0 || mergeLoading || mutation.current) return
    const sequence = ++previewSequence.current
    setPreview(null)
    setMergeLoading(true)
    setError('')
    try {
      const result = await api<MergePreview>('/api/v1/admin/tags/merge/preview', {
        method: 'POST',
        body: JSON.stringify(mergeBody()),
      })
      if (sequence === previewSequence.current) setPreview(result.data)
    } catch (failure) {
      if (sequence === previewSequence.current) setError((failure as Error).message)
    } finally {
      if (sequence === previewSequence.current) setMergeLoading(false)
    }
  }
  const bulkDelete = () => {
    if (
      !selected.size ||
      !confirm('删除选中的' + selected.size + '个标签？仅解除关联，任何一个版本冲突都会整批回滚。')
    )
      return
    void run(async () => {
      await api('/api/v1/admin/tags/bulk', {
        method: 'POST',
        body: JSON.stringify({ items: [...selected].map(([id, revision]) => ({ id, revision })) }),
      })
      setMessage('选中标签已删除，正文保留。' + detachDeleted([...selected.keys()]))
    })
  }
  const categoryRows = (nodes: CategoryNode[], depth = 0): ReactNode =>
    nodes.map((item) => (
      <div key={item.id} className="space-y-2" style={{ marginLeft: depth ? 20 : 0 }}>
        <SortableCategory item={item} disabled={!writable || busy}>
          <div className="inline-flex max-w-full flex-wrap items-center gap-2">
            {!!item.children.length && (
              <button
                type="button"
                aria-label={'展开或折叠 ' + item.name}
                aria-expanded={expanded.has(item.id) || !!search}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous)
                    if (next.has(item.id)) next.delete(item.id)
                    else next.add(item.id)
                    return next
                  })
                }
              >
                {expanded.has(item.id) || search ? '▾' : '▸'}
              </button>
            )}
            <button
              type="button"
              onClick={() => choose(item)}
              className="max-w-full text-left font-semibold break-all"
            >
              {item.name}
            </button>
            <span className="text-muted-foreground text-xs break-all">
              /{item.slug} · {item.articleCount ?? 0}篇
            </span>
            <button
              type="button"
              onClick={() => choose(item)}
              aria-label={'编辑分类 ' + item.name}
              className="text-brand text-xs"
            >
              {writable ? '编辑' : '查看'}
            </button>
            {writable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(item)}
                aria-label={'删除分类 ' + item.name}
                className="text-destructive text-xs"
              >
                删除
              </button>
            )}
          </div>
        </SortableCategory>
        {(expanded.has(item.id) || search) && categoryRows(item.children, depth + 1)}
      </div>
    ))
  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{label}管理</h1>
        {writable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(null)}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
          >
            新建{label}
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="text-destructive mb-4 whitespace-pre-wrap">
          {error}
        </p>
      )}
      <p role="status" className="mb-4 text-sm">
        {message}
      </p>
      {recovery && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <span>发现当前用户的未保存{label}表单，恢复将保留原修订号。</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (dirty() && !confirm('放弃当前表单并恢复本地稿？')) return
              current.current = recovery.draft
              setDraft(recovery.draft)
              setEditing(recovery.editing)
              manualSlug.current = true
              setRecovery(null)
            }}
          >
            恢复未保存表单
          </button>
          <button type="button" disabled={busy} onClick={clearLocal}>
            丢弃本地稿
          </button>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <input
          aria-label={'搜索' + label}
          placeholder={'搜索名称或slug'}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 basis-full rounded-lg border bg-transparent px-3 py-2 sm:flex-1 sm:basis-0"
        />
        {!isCategory && (
          <>
            <select
              aria-label="标签排序"
              value={params.get('sort') ?? 'usage'}
              onChange={(event) => navigate({ sort: event.target.value })}
              className="bg-background rounded border px-3 py-2"
            >
              <option value="usage">使用次数</option>
              <option value="name">名称</option>
              <option value="newest">最新创建</option>
            </select>
            <select
              aria-label="每页标签数"
              value={params.get('pageSize') ?? '20'}
              onChange={(event) => navigate({ pageSize: event.target.value })}
              className="bg-background rounded border px-3 py-2"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}条
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setView((value) => (value === 'table' ? 'cloud' : 'table'))}
              className="rounded border px-3 py-2"
            >
              {view === 'table' ? '标签云' : '切回表格'}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSelected(new Map())
            setRefresh((value) => value + 1)
            setMessage('列表刷新不会覆盖未保存表单；需比较后载入最新。')
          }}
          className="rounded border px-3 py-2"
        >
          刷新列表
        </button>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0" aria-label={label + '列表'}>
          <p className="text-muted-foreground mb-4 text-sm">
            {isCategory
              ? '最多两层；拖拽手柄或空格/方向键排序仅改变同父级顺序。先移走子分类才能删除父分类。'
              : '文章、日志、作品共用；使用数含草稿及回收站。创建后slug只读，改slug请新建后合并。'}
          </p>
          {!ready ? (
            <p>加载{label}…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border p-8 text-center">暂无{label}</p>
          ) : isCategory ? (
            <DndContext
              sensors={sensors}
              collisionDetection={(args) =>
                closestCenter({
                  ...args,
                  droppableContainers: args.droppableContainers.filter((item) =>
                    sameParent(String(args.active.id), String(item.id)),
                  ),
                })
              }
              onDragEnd={({ active, over }) => {
                if (over && !busy && active.id !== over.id) move(String(active.id), String(over.id))
              }}
            >
              <SortableContext
                items={flattenCategories(filtered).map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">{categoryRows(filtered)}</div>
              </SortableContext>
            </DndContext>
          ) : view === 'cloud' ? (
            <div className="flex flex-wrap items-baseline gap-4 rounded-xl border p-5">
              {tags.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => navigate({ q: item.slug })}
                  className="max-w-full break-all"
                  style={{
                    fontSize: Math.min(30, 12 + Math.log2(1 + item.counts.total) * 3),
                    color: item.color ?? undefined,
                  }}
                >
                  {item.name} ({item.counts.total})
                </button>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {writable && <th className="p-3">选择</th>}
                    <th className="p-3">名称 / slug</th>
                    <th className="p-3">使用次数</th>
                    <th className="p-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((item) => (
                    <tr key={item.id} className="border-t">
                      {writable && (
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={'选择标签 ' + item.name}
                            disabled={busy}
                            checked={selected.has(item.id)}
                            onChange={(event) => {
                              const checked = event.target.checked
                              setSelected((previous) => {
                                const next = new Map(previous)
                                if (checked) next.set(item.id, item.revision)
                                else next.delete(item.id)
                                return next
                              })
                            }}
                          />
                        </td>
                      )}
                      <td className="max-w-48 p-3 break-all">
                        <span style={{ color: item.color ?? undefined }}>{item.name}</span>
                        <p className="text-muted-foreground text-xs">/{item.slug}</p>
                      </td>
                      <td className="p-3">
                        <p>总计 {item.counts.total}</p>
                        <p className="text-muted-foreground text-xs whitespace-nowrap">
                          文章{item.counts.article} · 日志{item.counts.log} · 作品
                          {item.counts.project}
                        </p>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => choose(item)}
                            aria-label={'编辑标签 ' + item.name}
                          >
                            {writable ? '编辑' : '查看'}
                          </button>
                          {writable && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => remove(item)}
                              aria-label={'删除标签 ' + item.name}
                              className="text-destructive"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isCategory && (
            <>
              <nav
                aria-label="标签分页"
                className="my-5 flex items-center justify-between gap-3 text-sm"
              >
                <button
                  type="button"
                  disabled={page <= 1 || busy || !ready}
                  onClick={() => navigate({ page: String(page - 1) })}
                >
                  上一页
                </button>
                <span>
                  第{page}/{data.pages}页 · 共{data.total}条
                </span>
                <button
                  type="button"
                  disabled={page >= data.pages || busy || !ready}
                  onClick={() => navigate({ page: String(page + 1) })}
                >
                  下一页
                </button>
              </nav>
              {writable && selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                  <span>已选{selected.size}项</span>
                  <button type="button" disabled={busy} onClick={openMerge}>
                    合并标签
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={bulkDelete}
                    className="text-destructive"
                  >
                    批量删除
                  </button>
                  <button type="button" onClick={() => setSelected(new Map())}>
                    取消选择
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault()
            if (writable) save()
          }}
          className="min-w-0 rounded-xl border p-5"
        >
          <h2 className="mb-5 font-semibold">
            {editing ? (writable ? '编辑' : '查看') : '新建'}
            {label}
            {editing ? '：' + editing.name : ''}
          </h2>
          {fieldErrors.length > 0 && (
            <ul role="alert" className="text-destructive mb-4 text-sm">
              {fieldErrors.map((issue, index) => (
                <li key={index}>
                  {issue.path}：{issue.message}
                </li>
              ))}
            </ul>
          )}
          <fieldset disabled={!writable || busy || !ready} className="space-y-4">
            <label className="block text-sm">
              名称
              <input
                name="name"
                aria-label={label + '名称'}
                value={draft.name}
                maxLength={200}
                className={control}
                onChange={(event) => setField('name', event.target.value)}
              />
            </label>
            <label className="block text-sm">
              slug
              <input
                name="slug"
                aria-label={label + 'slug'}
                readOnly={!isCategory && !!editing}
                value={draft.slug}
                maxLength={200}
                className={control}
                onChange={(event) => setField('slug', event.target.value)}
              />
            </label>
            <p className="text-muted-foreground text-xs">
              {isCategory
                ? '修改slug会使旧分类链接失效。'
                : '创建后slug不可修改，重命名仅改显示名称。'}
            </p>
            <label className="block text-sm">
              颜色（#RRGGBB，可留空）
              <input
                name="color"
                aria-label={label + '颜色'}
                placeholder="#6366f1"
                value={draft.color}
                className={control}
                onChange={(event) => setField('color', event.target.value)}
              />
            </label>
            {isCategory && (
              <>
                <label className="block text-sm">
                  描述
                  <textarea
                    name="description"
                    aria-label="分类描述"
                    value={draft.description}
                    className={control}
                    onChange={(event) => setField('description', event.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  父分类
                  <select
                    name="parentId"
                    aria-label="父分类"
                    value={draft.parentId}
                    className={control}
                    disabled={!!editing?.childCount}
                    onChange={(event) => setField('parentId', event.target.value)}
                  >
                    <option value="">无（顶级分类）</option>
                    {tree
                      .filter((item) => item.id !== editing?.id)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-sm">
                  顺序
                  <input
                    name="order"
                    aria-label="分类顺序"
                    type="number"
                    min={0}
                    max={1000000}
                    value={draft.order}
                    className={control}
                    onChange={(event) => setField('order', event.target.value)}
                  />
                </label>
                <ProfileIconPicker
                  value={draft.icon}
                  disabled={busy || !writable}
                  label="分类图标"
                  onChange={(value) => setField('icon', value)}
                />
              </>
            )}
            {writable && (
              <button
                type="submit"
                className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
              >
                保存{label}
              </button>
            )}
          </fieldset>
          {editing && (
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                disabled={busy || !ready}
                onClick={() => {
                  const latest = isCategory
                    ? flat.find((item) => item.id === editing.id)
                    : tags.find((item) => item.id === editing.id)
                  if (latest) choose(latest)
                  else setMessage('当前筛选页未包含此项，请清空筛选或切回原页后比较。')
                }}
              >
                载入当前列表版本
              </button>
              {isCategory && (
                <Link
                  href={'/admin/articles?category=' + encodeURIComponent(editing.slug)}
                  className="text-brand"
                >
                  查看关联文章 →
                </Link>
              )}
            </div>
          )}
        </form>
      </div>
      {mergeOpen && (
        <dialog
          ref={dialog}
          aria-labelledby="merge-heading"
          className="bg-background text-foreground m-auto w-[calc(100%_-_24px)] max-w-lg rounded-xl border p-6 backdrop:bg-black/70"
          onCancel={(event) => {
            if (busy) event.preventDefault()
            else {
              previewSequence.current++
              setMergeLoading(false)
              setMergeOpen(false)
            }
          }}
        >
          <h2 id="merge-heading" className="text-xl font-semibold">
            合并标签
          </h2>
          <p className="text-destructive mt-3 text-sm">
            合并不可撤销；源标签会删除，全部关联转移到目标且去重，正文保留。
          </p>
          {error && (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {error}
            </p>
          )}
          <p className="mt-4 text-sm break-words">
            已选来源：{sources.map((item) => item.name).join('、')}
          </p>
          <label className="mt-4 block text-sm">
            查找目标
            <input
              aria-label="查找合并目标"
              disabled={busy}
              value={targetQuery}
              className={control}
              onChange={(event) => {
                previewSequence.current++
                setMergeLoading(false)
                setPreview(null)
                setTarget(null)
                setTargetQuery(event.target.value)
              }}
            />
          </label>
          <label className="mt-4 block text-sm">
            保留的目标标签
            <select
              aria-label="合并目标标签"
              disabled={busy}
              value={target?.id ?? ''}
              className={control}
              onChange={(event) => {
                previewSequence.current++
                setMergeLoading(false)
                setTarget(targets.find((item) => item.id === event.target.value) ?? null)
                setPreview(null)
              }}
            >
              <option value="">请选择</option>
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} /{item.slug}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!target || mergeLoading || busy || mergeBody().sources.length === 0}
            onClick={() => void mergePreview()}
            className="mt-4 rounded border px-3 py-2"
          >
            {mergeLoading ? '计算中…' : '查看合并影响'}
          </button>
          {preview && (
            <div className="mt-4 rounded border p-4 text-sm" aria-label="合并影响预览">
              <p>
                保留：{preview.target.name} /{preview.target.slug}
              </p>
              <p className="mt-2">
                影响内容（去重）：文章{preview.affected.article}、日志{preview.affected.log}、作品
                {preview.affected.project}，合计{preview.affected.total}。
              </p>
              <p className="mt-2">
                新增目标关联：{preview.additions.total}；确认时重新计算实际结果。
              </p>
              <p className="mt-2 break-words">
                删除来源：{preview.sources.map((item) => item.name).join('、')}
              </p>
            </div>
          )}
          <div className="mt-5 flex gap-4">
            <button
              type="button"
              disabled={busy || !preview}
              className="bg-destructive/10 text-destructive rounded border px-3 py-2"
              onClick={() => {
                void run(async () => {
                  await api('/api/v1/admin/tags/merge', {
                    method: 'POST',
                    body: JSON.stringify(mergeBody()),
                  })
                  setMergeOpen(false)
                  setMessage(
                    '标签合并完成，来源已删除，正文保留。' +
                      detachDeleted(mergeBody().sources.map((item) => item.id)),
                  )
                })
              }}
            >
              确认合并
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                previewSequence.current++
                setMergeOpen(false)
              }}
            >
              取消
            </button>
          </div>
        </dialog>
      )}
    </div>
  )
}
