'use client'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { PROJECT_TYPES, projectDate } from '@/lib/project-display'
import {
  projectListQuery,
  projectReorder,
  remainingProjectSelection,
  selectProjectRange,
} from '@/lib/project-list-controls'
import { useAdminUser } from './shell'

type Row = {
  id: string
  title: string
  description: string
  type: keyof typeof PROJECT_TYPES
  revision: number
  order: number
  status: string
  featured: boolean
  coverImage: string | null
  startDate: string | null
  updatedAt: string
  viewCount: number
  techStack: string[]
  tags: { id: string; name: string; slug: string }[]
}
type Options = { tags: { id: string; name: string; slug: string }[]; techStack: string[] }
type BulkResult = { succeeded: string[]; failed: { id: string; code?: string; message?: string }[] }
const control = 'bg-background rounded-lg border px-3 py-2 text-sm'
const columnLabels = {
  type: '类型',
  status: '状态',
  tech: '技术栈',
  date: '开始日期',
  updated: '更新时间',
  views: '浏览量',
}
const initialColumns = {
  type: true,
  status: true,
  tech: true,
  date: true,
  updated: false,
  views: false,
}
const statuses: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' }
const actions: Record<string, string> = {
  publish: '发布',
  unpublish: '下架',
  archive: '归档',
  delete: '删除',
  restore: '恢复',
  featured: '设为精选',
  unfeatured: '取消精选',
}

/** URL筛选及跨页CAS选择；排序只提交当前筛选页，未知作品不参与写入。 */
export function ProjectList({ trash = false }: { trash?: boolean }) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('content:write')
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams(),
    query = params.toString()
  const [rows, setRows] = useState<Row[]>([]),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [columns, setColumns] = useState(initialColumns),
    [options, setOptions] = useState<Options>({ tags: [], techStack: [] })
  const [optionsError, setOptionsError] = useState(''),
    [bulkTags, setBulkTags] = useState<string[]>([])
  const [search, setSearch] = useState(params.get('q') ?? '')
  const anchor = useRef<number | null>(null),
    searchInput = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null)
  const dragId = useRef<string | null>(null)
  const view = trash ? 'list' : params.get('view') === 'grid' ? 'grid' : 'list',
    page = Math.max(1, Number(params.get('page')) || 1)
  const reorderable = writable && !trash && !params.has('sort') && !busy && !loading && !error
  const navigate = (patch: Record<string, string | null>) => {
    const next = projectListQuery(query, patch)
    router.replace(path + (next.size ? '?' + next : ''))
  }
  useEffect(() => {
    let active = true
    void api<Options>('/api/v1/admin/projects/options')
      .then(({ data }) => {
        if (active) setOptions(data)
      })
      .catch((error: Error) => {
        if (active) setOptionsError(error.message)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('project-table-columns') ?? 'null')
      if (saved)
        setColumns(
          Object.fromEntries(
            Object.entries(initialColumns).map(([key, value]) => [
              key,
              typeof saved[key] === 'boolean' ? saved[key] : value,
            ]),
          ) as typeof initialColumns,
        )
      const preferred = localStorage.getItem('project-admin-view')
      if (!trash && !params.has('view') && ['list', 'grid'].includes(preferred ?? ''))
        navigate({ view: preferred })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSearch(params.get('q') ?? '')
    anchor.current = null
  }, [params])
  useEffect(() => {
    if (search === (params.get('q') ?? '')) return
    const timer = setTimeout(() => navigate({ q: search }), 300)
    return () => clearTimeout(timer)
  }, [search, query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    anchor.current = null
    const request = new URLSearchParams(query)
    request.delete('view')
    request.set('includeDeleted', String(trash))
    if (!request.has('pageSize')) request.set('pageSize', '10')
    void api<Row[]>('/api/v1/admin/projects?' + request)
      .then((result) => {
        if (!active) return
        setRows(result.data)
        setPages(result.meta?.totalPages ?? 1)
        setTotal(result.meta?.total ?? result.data.length)
        setLoading(false)
      })
      .catch((error: Error) => {
        if (active) {
          setError(error.message)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [query, trash, refresh])
  const choose = (index: number, checked: boolean, range = false) => {
    setSelected((previous) =>
      selectProjectRange(previous, rows, index, checked, range ? anchor.current : null),
    )
    anchor.current = index
  }
  const success = (ids: string[]) => {
    setSelected((previous) => remainingProjectSelection(previous, ids))
    setRefresh((value) => value + 1)
  }
  const act = async (row: Row, action: 'delete' | 'restore' | 'purge') => {
    if (busy) return
    if (
      action === 'purge'
        ? prompt('彻底删除不可恢复，请输入标题：' + row.title) !== row.title
        : !confirm(action === 'restore' ? '恢复这个作品？' : '将这个作品移入回收站？')
    )
      return
    setBusy(true)
    try {
      await api('/api/v1/admin/projects/' + row.id + (action === 'delete' ? '' : '/' + action), {
        method: action === 'restore' ? 'POST' : 'DELETE',
        body: JSON.stringify({ revision: row.revision }),
      })
      success([row.id])
      setMessage(
        action === 'restore'
          ? '作品已恢复'
          : action === 'purge'
            ? '作品已彻底删除'
            : '作品已移入回收站',
      )
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const feature = async (row: Row) => {
    setBusy(true)
    try {
      await api('/api/v1/admin/projects/' + row.id, {
        method: 'PATCH',
        body: JSON.stringify({ revision: row.revision, featured: !row.featured }),
      })
      success([row.id])
      setMessage(row.featured ? '已取消精选' : '已设为精选')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const preview = async (row: Row) => {
    setBusy(true)
    try {
      const { data } = await api<{ url: string }>(
        '/api/v1/admin/projects/' + row.id + '/preview-token',
        { method: 'POST' },
      )
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const bulk = async (action: string) => {
    const ids = Object.keys(selected)
    if (!ids.length || busy) return
    if (ids.length > 100) {
      setMessage('每批最多100个作品，请减少选择')
      return
    }
    if (['addTags', 'removeTags'].includes(action) && !bulkTags.length) {
      setMessage('请先选择标签')
      return
    }
    if (
      ['delete', 'archive', 'unpublish'].includes(action) &&
      !confirm('确认对所选作品执行' + actions[action] + '？')
    )
      return
    setBusy(true)
    try {
      let data: BulkResult
      if (['featured', 'unfeatured'].includes(action)) {
        data = { succeeded: [], failed: [] }
        for (const id of ids) {
          try {
            await api('/api/v1/admin/projects/' + id, {
              method: 'PATCH',
              body: JSON.stringify({ revision: selected[id], featured: action === 'featured' }),
            })
            data.succeeded.push(id)
          } catch (error) {
            data.failed.push({ id, message: (error as Error).message })
          }
        }
      } else
        data = (
          await api<BulkResult>('/api/v1/admin/projects/bulk', {
            method: 'POST',
            body: JSON.stringify({
              ids,
              revisions: selected,
              action,
              ...(['addTags', 'removeTags'].includes(action)
                ? { payload: { tagIds: bulkTags } }
                : {}),
            }),
          })
        ).data
      setMessage(
        `成功${data.succeeded.length}条，失败${data.failed.length}条。` +
          data.failed.map((entry) => `${entry.id}：${entry.message ?? entry.code}`).join('；') +
          (data.failed.length ? '失败项仍保留选择；冲突请取消选择后重新选择最新版本。' : ''),
      )
      success(data.succeeded)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const reorder = async (from: string, to: string) => {
    if (!reorderable) return
    setBusy(true)
    try {
      const items = projectReorder(rows, from, to)
      if (!items.length) return
      await api('/api/v1/admin/projects/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      })
      success(items.map((item) => item.id))
      setMessage('当前筛选页排序已保存；其它作品的排序值保持原值')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
      dragId.current = null
    }
  }
  const sort = (key: string) =>
    navigate({ sort: params.get('sort') === key + ':asc' ? key + ':desc' : key + ':asc' })
  const selection = (row: Row, index: number) =>
    writable && (
      <input
        type="checkbox"
        aria-label={'选择' + row.title}
        checked={Object.hasOwn(selected, row.id)}
        disabled={busy}
        onChange={(event) =>
          choose(index, event.target.checked, (event.nativeEvent as MouseEvent).shiftKey)
        }
      />
    )
  const rowActions = (row: Row, index: number) => (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={'/admin/projects/' + row.id}>{writable && !trash ? '编辑' : '查看'}</Link>
      {!trash && (
        <button type="button" disabled={busy} onClick={() => void preview(row)}>
          预览
        </button>
      )}
      {writable && (
        <details>
          <summary className="cursor-pointer" aria-label={'更多操作：' + row.title}>
            ⋯
          </summary>
          <div className="bg-card absolute z-10 flex flex-col gap-3 rounded-lg border p-3">
            {trash ? (
              <>
                <button disabled={busy} onClick={() => void act(row, 'restore')}>
                  恢复
                </button>
                {user?.role === 'ADMIN' && (
                  <button
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => void act(row, 'purge')}
                  >
                    彻底删除
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => void act(row, 'delete')}
                >
                  移入回收站
                </button>
                <button
                  disabled={!reorderable || index === 0}
                  onClick={() => void reorder(row.id, rows[index - 1].id)}
                >
                  上移
                </button>
                <button
                  disabled={!reorderable || index === rows.length - 1}
                  onClick={() => void reorder(row.id, rows[index + 1].id)}
                >
                  下移
                </button>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  )
  const hasFilters = ['q', 'type', 'status', 'tag', 'tech', 'from', 'to', 'featured'].some((key) =>
    params.has(key),
  )
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{trash ? '作品回收站' : '作品管理'}</h1>
        <div className="flex gap-4 text-sm">
          <Link href={trash ? '/admin/projects' : '/admin/projects/trash'}>
            {trash ? '返回列表' : '回收站'}
          </Link>
          {writable && !trash && (
            <Link
              href="/admin/projects/new"
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
            >
              新建作品 +
            </Link>
          )}
        </div>
      </header>
      <div className="my-6 flex flex-wrap gap-3">
        <input
          ref={searchInput}
          aria-label="筛选作品"
          className={control + ' min-w-0 flex-1'}
          placeholder="搜索标题或正文"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="作品类型筛选"
          className={control}
          value={params.get('type') ?? ''}
          onChange={(event) => navigate({ type: event.target.value })}
        >
          <option value="">全部类型</option>
          {Object.entries(PROJECT_TYPES).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
        <select
          aria-label="作品状态筛选"
          className={control}
          value={params.get('status') ?? ''}
          onChange={(event) => navigate({ status: event.target.value })}
        >
          <option value="">全部状态</option>
          {Object.entries(statuses).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="作品标签筛选"
          className={control}
          value={params.get('tag') ?? ''}
          onChange={(event) => navigate({ tag: event.target.value })}
        >
          <option value="">全部标签</option>
          {params.get('tag') && !options.tags.some((tag) => tag.slug === params.get('tag')) && (
            <option value={params.get('tag')!}>{params.get('tag')}</option>
          )}
          {options.tags.map((tag) => (
            <option key={tag.id} value={tag.slug}>
              {tag.name}
            </option>
          ))}
        </select>
        <select
          aria-label="技术栈筛选"
          className={control}
          value={params.get('tech') ?? ''}
          onChange={(event) => navigate({ tech: event.target.value })}
        >
          <option value="">全部技术栈</option>
          {params.get('tech') && !options.techStack.includes(params.get('tech')!) && (
            <option value={params.get('tech')!}>{params.get('tech')}</option>
          )}
          {options.techStack.map((tech) => (
            <option key={tech}>{tech}</option>
          ))}
        </select>
        <select
          aria-label="精选筛选"
          className={control}
          value={params.get('featured') ?? ''}
          onChange={(event) => navigate({ featured: event.target.value })}
        >
          <option value="">全部精选状态</option>
          <option value="true">精选</option>
          <option value="false">非精选</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          开始日期
          <input
            aria-label="开始日期"
            type="date"
            className={control}
            max={params.get('to') ?? '9998-12-31'}
            value={params.get('from') ?? ''}
            onChange={(event) => navigate({ from: event.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          结束日期
          <input
            aria-label="结束日期"
            type="date"
            className={control}
            min={params.get('from') ?? '0001-01-01'}
            value={params.get('to') ?? ''}
            onChange={(event) => navigate({ to: event.target.value })}
          />
        </label>
        <select
          aria-label="每页条数"
          className={control}
          value={params.get('pageSize') ?? '10'}
          onChange={(event) => navigate({ pageSize: event.target.value })}
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}条
            </option>
          ))}
        </select>
        <button className={control} onClick={() => router.replace(path)}>
          重置
        </button>
        {!trash &&
          ['list', 'grid'].map((mode) => (
            <button
              key={mode}
              className={control}
              aria-pressed={view === mode}
              onClick={() => {
                try {
                  localStorage.setItem('project-admin-view', mode)
                } catch {}
                navigate({ view: mode })
              }}
            >
              {mode === 'list' ? '列表' : '网格'}
            </button>
          ))}
        <details className="relative rounded-lg border p-2">
          <summary className="cursor-pointer text-sm">列设置</summary>
          <div className="bg-card absolute right-0 z-10 mt-2 w-40 space-y-3 rounded-lg border p-4">
            {Object.entries(columns).map(([key, shown]) => (
              <label key={key} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={(event) => {
                    const next = { ...columns, [key]: event.target.checked }
                    setColumns(next)
                    try {
                      localStorage.setItem('project-table-columns', JSON.stringify(next))
                    } catch {}
                  }}
                />
                {columnLabels[key as keyof typeof columns]}
              </label>
            ))}
          </div>
        </details>
      </div>
      {!trash && (
        <p className="text-muted-foreground mb-4 text-sm">
          仅重排当前筛选页，跨页与未显示作品不参与修改。清除表头排序后，可拖动「排序」手柄或在更多操作中上移/下移。
          <button className="text-brand ml-3" onClick={() => navigate({ sort: null })}>
            按自定义顺序
          </button>
        </p>
      )}
      {optionsError && <p role="alert">筛选选项读取失败：{optionsError}</p>}
      {message && (
        <p role="status" className="mb-4 text-sm break-words">
          {message}
          <button className="text-brand ml-3" onClick={() => setMessage('')}>
            关闭提示
          </button>
        </p>
      )}
      {error ? (
        <p role="alert">
          {error}
          <button className="text-brand ml-3" onClick={() => setRefresh((value) => value + 1)}>
            重试读取
          </button>
        </p>
      ) : loading ? (
        <div aria-label="正在加载作品" className="space-y-3">
          {[1, 2, 3].map((value) => (
            <div key={value} className="bg-muted h-20 rounded-lg" />
          ))}
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border p-10 text-center">
          <p>{hasFilters ? '筛选无结果' : trash ? '回收站为空' : '还没有作品'}</p>
          {hasFilters ? (
            <button onClick={() => router.replace(path)}>重置筛选</button>
          ) : (
            writable && !trash && <Link href="/admin/projects/new">新建第一个作品</Link>
          )}
        </div>
      ) : (
        <div
          ref={list}
          onKeyDown={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('input,select,textarea,button,a,summary')
            )
              return
            const item =
                event.target instanceof HTMLElement ? event.target.closest('[data-row]') : null,
              index = item ? Number(item.getAttribute('data-row')) : 0
            if (['j', 'k'].includes(event.key.toLowerCase())) {
              event.preventDefault()
              const visible = Array.from(
                list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [],
              ).filter((element) => element.offsetParent !== null)
              visible[
                Math.max(
                  0,
                  Math.min(rows.length - 1, index + (event.key.toLowerCase() === 'j' ? 1 : -1)),
                )
              ]?.focus()
            }
            if (event.key === '/') {
              event.preventDefault()
              searchInput.current?.focus()
            }
            if (event.key === 'Enter' && item) router.push('/admin/projects/' + rows[index].id)
            if (event.key.toLowerCase() === 'x' && item && writable && !busy) {
              event.preventDefault()
              choose(index, !Object.hasOwn(selected, rows[index].id), event.shiftKey)
            }
          }}
        >
          {writable && (
            <label className="mb-3 flex gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="全选当前页"
                disabled={busy}
                checked={rows.every((row) => Object.hasOwn(selected, row.id))}
                onChange={(event) => {
                  const checked = event.target.checked
                  setSelected((previous) =>
                    selectProjectRange(previous, rows, rows.length - 1, checked, 0),
                  )
                }}
              />
              全选当前页
            </label>
          )}
          <div
            className={
              view === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3 md:hidden'
            }
          >
            {rows.map((row, index) => (
              <article
                key={row.id}
                className="bg-card rounded-xl border p-4"
                data-row={index}
                tabIndex={0}
              >
                {view === 'grid' &&
                  (row.coverImage ? (
                    <Image
                      src={row.coverImage}
                      alt={row.title}
                      width={640}
                      height={360}
                      unoptimized
                      className="mb-4 aspect-video w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="bg-muted mb-4 flex aspect-video items-center justify-center rounded-lg text-4xl">
                      {PROJECT_TYPES[row.type].icon}
                    </div>
                  ))}
                <div className="flex items-center gap-3">
                  {selection(row, index)}
                  <Link className="font-semibold" href={'/admin/projects/' + row.id}>
                    {row.title}
                  </Link>
                </div>
                <p className="text-muted-foreground my-2 line-clamp-2 text-sm">{row.description}</p>
                <p className="mb-2 text-sm">
                  {PROJECT_TYPES[row.type].label} · {statuses[row.status]} ·{' '}
                  {projectDate(row.startDate) || '未设置日期'}
                </p>
                <p className="text-muted-foreground mb-3 text-sm">{row.techStack.join(' / ')}</p>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input
                    aria-label={'精选：' + row.title}
                    type="checkbox"
                    checked={row.featured}
                    disabled={!writable || trash || busy}
                    onChange={() => void feature(row)}
                  />
                  精选
                </label>
                {rowActions(row, index)}
              </article>
            ))}
          </div>
          {view === 'list' && (
            <div className="hidden overflow-x-auto rounded-xl border md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {writable && <th className="p-3">选择</th>}
                    {!trash && <th className="p-3">排序</th>}
                    <th className="p-3">
                      <button onClick={() => sort('title')}>标题 ↕</button>
                    </th>
                    {Object.entries(columns)
                      .filter(([, shown]) => shown)
                      .map(([key]) => (
                        <th className="p-3" key={key}>
                          {['date', 'updated', 'views'].includes(key) ? (
                            <button
                              onClick={() =>
                                sort(
                                  (
                                    {
                                      date: 'startDate',
                                      updated: 'updatedAt',
                                      views: 'viewCount',
                                    } as Record<string, string>
                                  )[key],
                                )
                              }
                            >
                              {columnLabels[key as keyof typeof columns]} ↕
                            </button>
                          ) : (
                            columnLabels[key as keyof typeof columns]
                          )}
                        </th>
                      ))}
                    <th className="p-3">精选</th>
                    <th className="p-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr
                      key={row.id}
                      data-row={index}
                      tabIndex={0}
                      className="focus:bg-muted border-t"
                      onDragOver={(event) => {
                        if (reorderable) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (dragId.current) void reorder(dragId.current, row.id)
                      }}
                    >
                      {writable && <td className="p-3">{selection(row, index)}</td>}
                      {!trash && (
                        <td className="p-3">
                          <button
                            aria-label={'拖拽排序：' + row.title}
                            draggable={reorderable}
                            disabled={!reorderable}
                            onDragStart={(event) => {
                              dragId.current = row.id
                              event.dataTransfer.setData('text/plain', row.id)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => {
                              dragId.current = null
                            }}
                          >
                            ☰ {row.order}
                          </button>
                        </td>
                      )}
                      <td className="p-3">
                        <Link href={'/admin/projects/' + row.id} className="font-medium">
                          {row.title}
                        </Link>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {row.tags.map((tag) => tag.name).join(' · ')}
                        </p>
                      </td>
                      {columns.type && <td className="p-3">{PROJECT_TYPES[row.type].label}</td>}
                      {columns.status && <td className="p-3">{statuses[row.status]}</td>}
                      {columns.tech && (
                        <td className="max-w-48 p-3">{row.techStack.join(' / ')}</td>
                      )}
                      {columns.date && (
                        <td className="p-3 whitespace-nowrap">
                          {projectDate(row.startDate) || '—'}
                        </td>
                      )}
                      {columns.updated && (
                        <td className="p-3 whitespace-nowrap">
                          {new Intl.DateTimeFormat('zh-CN', {
                            dateStyle: 'short',
                            timeZone: 'Asia/Shanghai',
                          }).format(new Date(row.updatedAt))}
                        </td>
                      )}
                      {columns.views && <td className="p-3">{row.viewCount}</td>}
                      <td className="p-3">
                        <input
                          aria-label={'精选：' + row.title}
                          type="checkbox"
                          checked={row.featured}
                          disabled={!writable || trash || busy}
                          onChange={() => void feature(row)}
                        />
                      </td>
                      <td className="relative p-3">{rowActions(row, index)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {writable && Object.keys(selected).length > 0 && (
        <div className="bg-card sticky bottom-4 mt-6 flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm shadow-lg">
          <span>已选{Object.keys(selected).length}条（含其它页）</span>
          {(trash
            ? ['restore']
            : ['publish', 'unpublish', 'archive', 'featured', 'unfeatured', 'delete']
          ).map((action) => (
            <button key={action} disabled={busy} onClick={() => void bulk(action)}>
              {actions[action]}
            </button>
          ))}
          {!trash && (
            <>
              <label>
                批量标签
                <select
                  aria-label="批量标签选择"
                  multiple
                  className={control + ' ml-2'}
                  value={bulkTags}
                  disabled={busy}
                  onChange={(event) =>
                    setBulkTags(
                      Array.from(event.target.selectedOptions, (option) => option.value).slice(
                        0,
                        10,
                      ),
                    )
                  }
                >
                  {options.tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy || !bulkTags.length} onClick={() => void bulk('addTags')}>
                添加标签
              </button>
              <button disabled={busy || !bulkTags.length} onClick={() => void bulk('removeTags')}>
                移除标签
              </button>
            </>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setSelected({})
              anchor.current = null
            }}
          >
            清空选择
          </button>
        </div>
      )}
      <nav aria-label="作品分页" className="mt-6 flex justify-between text-sm">
        <button
          disabled={loading || page <= 1}
          onClick={() => navigate({ page: String(page - 1) })}
        >
          上一页
        </button>
        <span>
          {page}/{Math.max(1, pages)} · 共{total}条
        </span>
        <button
          disabled={loading || page >= pages}
          onClick={() => navigate({ page: String(page + 1) })}
        >
          下一页
        </button>
      </nav>
    </div>
  )
}
