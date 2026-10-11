'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { chinaToday, LOG_TYPES } from '@/lib/log-display'
import { LogCalendar, type LogCalendarData } from '@/components/site/log-calendar'
import { AdminDialog } from './dialog'
import { LogEditor } from './log-editor'
import { useAdminUser } from './shell'

type Row = {
  id: string
  title: string
  logDate: string
  type: keyof typeof LOG_TYPES
  revision: number
  status: string
  viewCount: number
  isPinned: boolean
  updatedAt: string
  tags: { slug: string; name: string }[]
}
type TagOption = { id: string; name: string; slug: string }
const control = 'bg-background rounded-lg border px-3 py-2 text-sm'
/** 筛选、分页、视图写回URL；跨页选择同时保存修订号，批量操作仍走服务端CAS。 */
export function LogList({ trash = false }: { trash?: boolean }) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('content:write')
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams(),
    query = params.toString()
  const [rows, setRows] = useState<Row[]>([]),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0)
  const [calendar, setCalendar] = useState<LogCalendarData | null>(null)
  const [loading, setLoading] = useState(true),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState(params.get('quick') === '1'),
    [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [columns, setColumns] = useState({ type: true, status: true, date: true, views: false })
  const [tags, setTags] = useState<TagOption[]>([]),
    [bulkTagIds, setBulkTagIds] = useState<string[]>([]),
    [tagError, setTagError] = useState(''),
    [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const lastSelected = useRef<number | null>(null),
    table = useRef<HTMLTableElement>(null),
    searchInput = useRef<HTMLInputElement>(null)
  const today = chinaToday(),
    year = Number(params.get('year')) || Number(today.slice(0, 4)),
    month = Number(params.get('month')) || Number(today.slice(5, 7))
  const view = trash ? 'list' : (params.get('view') ?? 'calendar'),
    page = Number(params.get('page')) || 1
  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    if (!Object.hasOwn(patch, 'page')) next.delete('page')
    lastSelected.current = null
    router.replace(path + '?' + next)
  }
  useEffect(() => {
    let active = true
    void api<{ tags: TagOption[] }>('/api/v1/admin/articles/options')
      .then((result) => {
        if (active) setTags(result.data.tags)
      })
      .catch((error: Error) => {
        if (active) setTagError(error.message)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    // 选择集合可跨页保留，Shift锚点只能属于当前数据页。
    lastSelected.current = null
    setMessage('')
  }, [query, trash])
  useEffect(() => setSearch(params.get('q') ?? ''), [params])
  useEffect(() => {
    if (search === (params.get('q') ?? '')) return
    const timer = setTimeout(() => navigate({ q: search }), 300)
    return () => clearTimeout(timer)
  }, [search, query]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const saved = localStorage.getItem('log-table-columns')
      if (saved) setColumns({ ...columns, ...JSON.parse(saved) })
      const preferred = localStorage.getItem('log-admin-view')
      if (!trash && !params.has('view') && ['list', 'calendar'].includes(preferred ?? ''))
        navigate({ view: preferred })
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    lastSelected.current = null
    const request = new URLSearchParams(query)
    request.delete('view')
    request.set('includeDeleted', String(trash))
    const cal = new URLSearchParams()
    for (const key of ['q', 'type', 'mood', 'tag', 'status', 'from', 'to'])
      if (params.get(key)) cal.set(key, params.get(key)!)
    cal.set('year', String(year))
    cal.set('includeDeleted', String(trash))
    void Promise.all([
      api<Row[]>('/api/v1/admin/logs?' + request),
      view === 'calendar'
        ? api<LogCalendarData>('/api/v1/admin/logs/calendar?' + cal)
        : Promise.resolve(null),
    ])
      .then(([list, data]) => {
        if (active) {
          setRows(list.data)
          setPages(list.meta?.totalPages ?? 1)
          setTotal(list.meta?.total ?? list.data.length)
          setCalendar(data?.data ?? null)
          setLoading(false)
        }
      })
      .catch((error: Error) => {
        if (active) {
          setLoadError(error.message)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [query, trash, refresh, view, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (row: Row, action: 'delete' | 'restore' | 'purge') => {
    if (
      action === 'purge'
        ? prompt('彻底删除不可恢复，请输入标题：' + row.title) !== row.title
        : !confirm(action === 'restore' ? '恢复这篇日志？' : '将这篇日志移入回收站？')
    )
      return
    setBusy(true)
    try {
      await api('/api/v1/admin/logs/' + row.id + (action === 'delete' ? '' : '/' + action), {
        method: action === 'restore' ? 'POST' : 'DELETE',
        body: JSON.stringify({ revision: row.revision }),
      })
      setSelected((previous) => {
        const next = { ...previous }
        delete next[row.id]
        return next
      })
      setRefresh((value) => value + 1)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const bulk = async (action: string) => {
    if (!Object.keys(selected).length || busy) return
    if (['addTags', 'removeTags'].includes(action) && !bulkTagIds.length) {
      setMessage('请先选择要添加或移除的标签')
      return
    }
    if (
      ['delete', 'archive', 'unpublish'].includes(action) &&
      !confirm(
        '确认对所选日志执行' +
          ({ delete: '移入回收站', archive: '归档', unpublish: '下架' } as Record<string, string>)[
            action
          ] +
          '？',
      )
    )
      return
    setBusy(true)
    try {
      const { data } = await api<{
        succeeded: string[]
        failed: { id: string; message?: string; code: string }[]
      }>('/api/v1/admin/logs/bulk', {
        method: 'POST',
        body: JSON.stringify({
          ids: Object.keys(selected),
          revisions: selected,
          action,
          ...(['addTags', 'removeTags'].includes(action)
            ? { payload: { tagIds: bulkTagIds } }
            : {}),
        }),
      })
      setMessage(
        `成功${data.succeeded.length}条，失败${data.failed.length}条。` +
          data.failed.map((entry) => entry.message ?? entry.code).join('；'),
      )
      setSelected((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([id]) => !data.succeeded.includes(id))),
      )
      setRefresh((value) => value + 1)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const choose = (index: number, checked: boolean, range = false) => {
    const entries =
      range && lastSelected.current !== null && lastSelected.current < rows.length
        ? rows.slice(
            Math.min(index, lastSelected.current),
            Math.max(index, lastSelected.current) + 1,
          )
        : [rows[index]]
    setSelected((previous) => {
      const next = { ...previous }
      for (const row of entries) {
        if (checked) next[row.id] = row.revision
        else delete next[row.id]
      }
      return next
    })
    lastSelected.current = index
  }
  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{trash ? '日志回收站' : '日志管理'}</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href={trash ? '/admin/logs' : '/admin/logs/trash'}>
            {trash ? '返回列表' : '回收站'}
          </Link>
          {writable && !trash && (
            <>
              <Link href="/admin/logs/new">完整新建</Link>
              <button
                type="button"
                className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
                onClick={() => setQuick(true)}
              >
                记一笔
              </button>
            </>
          )}
        </div>
      </header>
      <div className="my-6 flex flex-wrap gap-3">
        <input
          ref={searchInput}
          aria-label="筛选日志"
          placeholder="搜索标题或正文"
          className={control + ' min-w-0 flex-1'}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="日志类型筛选"
          className={control}
          value={params.get('type') ?? ''}
          onChange={(event) => navigate({ type: event.target.value })}
        >
          <option value="">全部类型</option>
          {Object.entries(LOG_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="日志状态筛选"
          className={control}
          value={params.get('status') ?? ''}
          onChange={(event) => navigate({ status: event.target.value })}
        >
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="DRAFT">草稿</option>
          <option value="ARCHIVED">归档</option>
        </select>
        <select
          aria-label="日志标签筛选"
          className={control}
          value={params.get('tag') ?? ''}
          onChange={(event) => navigate({ tag: event.target.value })}
        >
          <option value="">全部标签</option>
          {params.get('tag') && !tags.some((tag) => tag.slug === params.get('tag')) && (
            <option value={params.get('tag')!}>{params.get('tag')}</option>
          )}
          {tags.map((tag) => (
            <option key={tag.id} value={tag.slug}>
              {tag.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          开始日期
          <input
            aria-label="开始日期"
            type="date"
            className={control}
            min="0001-01-01"
            max={params.get('to') ?? '9998-12-31'}
            value={params.get('from') ?? ''}
            onChange={(event) => navigate({ from: event.target.value, date: null })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          结束日期
          <input
            aria-label="结束日期"
            type="date"
            className={control}
            min={params.get('from') ?? '0001-01-01'}
            max="9998-12-31"
            value={params.get('to') ?? ''}
            onChange={(event) => navigate({ to: event.target.value, date: null })}
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
        <button type="button" className={control} onClick={() => router.replace(path)}>
          重置
        </button>
        {!trash &&
          ['list', 'calendar'].map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              className={control}
              onClick={() => {
                localStorage.setItem('log-admin-view', mode)
                navigate({ view: mode, date: null })
              }}
            >
              {mode === 'list' ? '列表' : '日历'}
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
                    localStorage.setItem('log-table-columns', JSON.stringify(next))
                  }}
                />
                {
                  (
                    { type: '类型', status: '状态', date: '记录日期', views: '浏览量' } as Record<
                      string,
                      string
                    >
                  )[key]
                }
              </label>
            ))}
          </div>
        </details>
      </div>
      {tagError && (
        <p role="alert" className="mb-4 text-sm">
          标签选项读取失败：{tagError}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mb-4 text-sm">
          {loadError}
          <button className="text-brand ml-3" onClick={() => setRefresh((value) => value + 1)}>
            重试读取
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 text-sm">
          {message}
          <button className="text-brand ml-3" onClick={() => setMessage('')}>
            关闭提示
          </button>
        </p>
      )}
      {view === 'calendar' && calendar && (
        <div className="mb-6 max-w-lg">
          <LogCalendar
            data={calendar}
            month={month}
            path={path}
            query={query}
            selectedDate={params.get('date') ?? undefined}
          />
        </div>
      )}
      {loading ? (
        <div aria-label="正在加载日志" className="space-y-3">
          {[1, 2, 3].map((index) => (
            <div key={index} className="bg-muted h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table
            ref={table}
            className="w-full text-left text-sm"
            onKeyDown={(event) => {
              if (
                event.target instanceof HTMLElement &&
                event.target.closest('input,select,textarea')
              )
                return
              const row =
                  event.target instanceof HTMLElement ? event.target.closest('tr[data-row]') : null,
                index = row ? Number(row.getAttribute('data-row')) : 0
              if (event.key === 'j' || event.key === 'k') {
                event.preventDefault()
                table.current
                  ?.querySelectorAll<HTMLTableRowElement>('tr[data-row]')
                  [
                    Math.max(0, Math.min(rows.length - 1, index + (event.key === 'j' ? 1 : -1)))
                  ]?.focus()
              }
              if (event.key === '/') {
                event.preventDefault()
                searchInput.current?.focus()
              }
              if (event.key === 'Enter' && row && event.target === row)
                router.push('/admin/logs/' + rows[index].id)
              if (event.key === 'x' && writable && row) choose(index, !selected[rows[index].id])
            }}
          >
            <thead className="bg-muted">
              <tr>
                {writable && (
                  <th className="p-3">
                    <input
                      aria-label="全选本页日志"
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((row) => !!selected[row.id])}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelected((previous) => {
                          const next = { ...previous }
                          for (const row of rows) {
                            if (checked) next[row.id] = row.revision
                            else delete next[row.id]
                          }
                          return next
                        })
                      }}
                    />
                  </th>
                )}
                <th className="p-3">标题</th>
                {columns.type && <th className="p-3">类型</th>}
                {columns.status && <th className="p-3">状态</th>}
                {columns.date && (
                  <th className="p-3">
                    <button
                      onClick={() =>
                        navigate({
                          sort: params.get('sort') === 'logDate' ? '-logDate' : 'logDate',
                        })
                      }
                    >
                      记录日期 ↕
                    </button>
                  </th>
                )}
                {columns.views && <th className="p-3">浏览量</th>}
                <th className="p-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, index) => (
                <tr key={row.id} data-row={index} tabIndex={0} className="focus:bg-muted">
                  {writable && (
                    <td className="p-3">
                      <input
                        aria-label={'选择' + row.title}
                        type="checkbox"
                        checked={!!selected[row.id]}
                        onChange={(event) =>
                          choose(
                            index,
                            event.target.checked,
                            (event.nativeEvent as MouseEvent).shiftKey,
                          )
                        }
                      />
                    </td>
                  )}
                  <td className="p-3">
                    <Link className="hover:text-brand font-medium" href={'/admin/logs/' + row.id}>
                      {row.isPinned && '📌 '}
                      {row.title}
                    </Link>
                  </td>
                  {columns.type && <td className="p-3">{LOG_TYPES[row.type]}</td>}
                  {columns.status && (
                    <td className="p-3">
                      {
                        (
                          { PUBLISHED: '已发布', DRAFT: '草稿', ARCHIVED: '归档' } as Record<
                            string,
                            string
                          >
                        )[row.status]
                      }
                    </td>
                  )}
                  {columns.date && (
                    <td className="p-3 whitespace-nowrap">{row.logDate.slice(0, 10)}</td>
                  )}
                  {columns.views && <td className="p-3">{row.viewCount}</td>}
                  <td className="p-3">
                    <div className="flex flex-wrap gap-3">
                      <Link href={'/admin/logs/' + row.id}>{writable ? '编辑' : '查看'}</Link>
                      {writable &&
                        (trash ? (
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
                          <button disabled={busy} onClick={() => void act(row, 'delete')}>
                            移入回收站
                          </button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && !message && (
            <p className="text-muted-foreground p-8 text-center">
              {params.get('date')
                ? '这天没有记录'
                : query
                  ? '筛选无结果，可重置条件'
                  : '还没有日志，点击记一笔开始记录。'}
            </p>
          )}
        </div>
      )}
      {writable && Object.keys(selected).length > 0 && (
        <div className="my-4 flex flex-wrap gap-4 rounded-lg border p-3 text-sm">
          <span>已选{Object.keys(selected).length}条</span>
          {(trash ? ['restore'] : ['publish', 'unpublish', 'archive', 'delete']).map((action) => (
            <button disabled={busy} key={action} onClick={() => void bulk(action)}>
              {
                (
                  {
                    restore: '恢复',
                    publish: '发布',
                    unpublish: '下架',
                    archive: '归档',
                    delete: '删除',
                  } as Record<string, string>
                )[action]
              }
            </button>
          ))}
          {!trash && (
            <>
              <label className="flex items-center gap-2">
                批量标签
                <select
                  aria-label="批量标签选择"
                  multiple
                  className={control}
                  value={bulkTagIds}
                  disabled={busy || !tags.length}
                  onChange={(event) =>
                    setBulkTagIds(
                      Array.from(event.target.selectedOptions, (option) => option.value).slice(
                        0,
                        10,
                      ),
                    )
                  }
                >
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy || !bulkTagIds.length} onClick={() => void bulk('addTags')}>
                添加标签
              </button>
              <button disabled={busy || !bulkTagIds.length} onClick={() => void bulk('removeTags')}>
                移除标签
              </button>
            </>
          )}
          <button
            onClick={() => {
              setSelected({})
              lastSelected.current = null
            }}
          >
            清空选择
          </button>
        </div>
      )}
      <nav aria-label="日志分页" className="mt-6 flex items-center justify-between text-sm">
        <button disabled={page <= 1} onClick={() => navigate({ page: String(page - 1) })}>
          上一页
        </button>
        <span>
          {page}/{Math.max(1, pages)} · 共{total}条
        </span>
        <button disabled={page >= pages} onClick={() => navigate({ page: String(page + 1) })}>
          下一页
        </button>
      </nav>
      <AdminDialog
        open={quick}
        title="记一笔"
        drawer
        onClose={() => {
          if (confirm('关闭抽屉？尚未保存的输入会保留为本地稿。')) setQuick(false)
        }}
      >
        {quick && (
          <LogEditor
            quick
            onSaved={() => {
              setQuick(false)
              setRefresh((value) => value + 1)
            }}
          />
        )}
      </AdminDialog>
    </div>
  )
}
