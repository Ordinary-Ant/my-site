'use client'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { api, ClientError } from '@/lib/api/client'
import type { MediaItem } from '@/lib/api/upload'
import { readMediaQuery, mediaQueryString, type MediaQuery } from '@/lib/media-controls'
import { useAdminUser } from './shell'
import { MediaUploadQueue } from './media-upload-queue'
type FolderSummary = {
  folders: { path: string; count: number; size: number }[]
  total: number
  totalSize: number
}
type Reference = { type: string; title: string; field: string }
type Result = { id: string; success: boolean; message: string }
const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40'
const control = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm'
const bytes = (size: number) =>
  size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + 'MB' : (size / 1024).toFixed(1) + 'KB'
export function MediaLibrary() {
  return <MediaBrowser />
}
/** 媒体选择器与媒体库共用查询、上传及引用信息；选择模式不改宿主编辑页URL。 */
export function MediaBrowser({
  onSelect,
  imagesOnly = false,
  onBusyChange,
  initialFiles,
}: {
  onSelect?: (item: MediaItem) => void
  imagesOnly?: boolean
  onBusyChange?: (busy: boolean) => void
  initialFiles?: File[]
}) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('media:write')
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams()
  const [localQuery, setLocalQuery] = useState<MediaQuery>({
    q: '',
    folder: '',
    kind: imagesOnly ? 'IMAGE' : '',
    page: 1,
  })
  const picker = !!onSelect
  const query = picker ? localQuery : readMediaQuery(params),
    key = mediaQueryString(query)
  const [search, setSearch] = useState(query.q),
    [items, setItems] = useState<MediaItem[]>([]),
    [pages, setPages] = useState(1)
  const [summary, setSummary] = useState<FolderSummary>({
    folders: [{ path: '/', count: 0, size: 0 }],
    total: 0,
    totalSize: 0,
  })
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [message, setMessage] = useState('')
  const [selected, setSelected] = useState<MediaItem | null>(null),
    [references, setReferences] = useState<Reference[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set()),
    [action, setAction] = useState<'delete' | 'move' | 'alt'>('move'),
    [target, setTarget] = useState('/'),
    [alt, setAlt] = useState('')
  const [results, setResults] = useState<Result[]>([]),
    [newFolder, setNewFolder] = useState('')
  const mounted = useRef(true),
    sequence = useRef(0),
    locked = useRef(false),
    detailBaseline = useRef(''),
    detailSequence = useRef(0),
    detail = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    onBusyChange?.(busy || uploadBusy)
  }, [busy, uploadBusy, onBusyChange])
  const changeQuery = useCallback(
    (patch: Partial<MediaQuery>) => {
      if (picker) setLocalQuery((current) => ({ ...current, ...patch }))
      else {
        const current = readMediaQuery(new URLSearchParams(window.location.search))
        router.replace(path + '?' + mediaQueryString({ ...current, ...patch }), { scroll: false })
      }
    },
    [picker, path, router],
  )
  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true)
    try {
      const [listing, folders] = await Promise.all([
        api<MediaItem[]>('/api/v1/admin/media' + (key ? '?' + key : '')),
        api<FolderSummary>('/api/v1/admin/media/folders'),
      ])
      if (!mounted.current || sequence.current !== current) return
      setItems(listing.data)
      setPages(Math.max(1, listing.meta?.totalPages ?? 1))
      setSummary(folders.data)
      if (query.page > Math.max(1, listing.meta?.totalPages ?? 1))
        changeQuery({ page: Math.max(1, listing.meta?.totalPages ?? 1) })
    } catch (error) {
      if (mounted.current && sequence.current === current) setMessage((error as Error).message)
    } finally {
      if (mounted.current && sequence.current === current) setLoading(false)
    }
    // key含所有筛选；详情编辑快照不能随列表更新覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, changeQuery])
  const latestLoad = useRef(load)
  useEffect(() => {
    latestLoad.current = load
    void load()
  }, [load])
  useEffect(() => {
    setSearch(query.q)
  }, [query.q])
  useEffect(() => {
    if (search === query.q) return
    const timer = setTimeout(() => changeQuery({ q: search, page: 1 }), 300)
    return () => clearTimeout(timer)
  }, [search, query.q, changeQuery])
  useEffect(() => {
    if (selected && !detail.current?.open) detail.current?.showModal()
    else if (!selected && detail.current?.open) detail.current.close()
  }, [selected])
  const openDetail = async (item: MediaItem) => {
    if (locked.current) return
    const current = ++detailSequence.current
    detailBaseline.current = JSON.stringify({ alt: item.alt, folder: item.folder })
    setSelected(item)
    setReferences(null)
    setMessage('')
    try {
      const response = await api<Reference[]>('/api/v1/admin/media/' + item.id + '/references')
      if (mounted.current && detailSequence.current === current) setReferences(response.data)
    } catch (error) {
      if (mounted.current && detailSequence.current === current)
        setMessage((error as Error).message)
    }
  }
  const run = async (task: () => Promise<void>) => {
    if (!writable || locked.current || uploadBusy) return
    locked.current = true
    setBusy(true)
    setMessage('')
    try {
      await task()
    } catch (error) {
      if (mounted.current) setMessage((error as Error).message)
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const errorMessage = (error: unknown) => {
    if (
      error instanceof ClientError &&
      error.code === 'MEDIA_IN_USE' &&
      Array.isArray(error.details)
    )
      return (
        error.message +
        '：' +
        (error.details as unknown as Reference[])
          .map((ref) => ref.type + '「' + ref.title + '」' + ref.field)
          .join('；')
      )
    return error instanceof Error ? error.message : '操作失败。'
  }
  const batch = () => {
    const ids = [...checked]
    if (
      !ids.length ||
      ids.length > 50 ||
      !confirm(
        '将对选中的' +
          ids.length +
          '个文件执行' +
          { delete: '永久删除（仍被引用的文件会保留）', move: '移动目录', alt: '更新替代文本' }[
            action
          ] +
          '，确定继续？',
      )
    )
      return
    const operation = action,
      folder = target,
      description = alt
    void run(async () => {
      setResults([])
      const report: Result[] = []
      for (const id of ids) {
        try {
          const response =
            operation === 'delete'
              ? await api<{ cleanupPending: boolean }>('/api/v1/admin/media/' + id, {
                  method: 'DELETE',
                })
              : await api('/api/v1/admin/media/' + id, {
                  method: 'PATCH',
                  body: JSON.stringify(
                    operation === 'move' ? { folder } : { alt: description || null },
                  ),
                })
          const pending =
            operation === 'delete' && (response.data as { cleanupPending: boolean }).cleanupPending
          report.push({
            id,
            success: true,
            message: pending ? '已删记录，存储清理待重试；原地址可能仍可访问。' : '操作成功。',
          })
        } catch (error) {
          report.push({ id, success: false, message: errorMessage(error) })
        }
        if (mounted.current) setResults([...report])
      }
      if (!mounted.current) return
      setChecked(new Set(report.filter((item) => !item.success).map((item) => item.id)))
      setMessage(
        '批量完成：成功' +
          report.filter((item) => item.success).length +
          '，失败' +
          report.filter((item) => !item.success).length +
          '。失败项保持选中，可单独处理后重试。',
      )
      void latestLoad.current()
    })
  }
  const closeDetail = () => {
    if (
      selected &&
      writable &&
      !picker &&
      JSON.stringify({ alt: selected.alt, folder: selected.folder }) !== detailBaseline.current &&
      !confirm('媒体信息尚未保存，确定放弃修改？')
    )
      return
    if (!locked.current) {
      detailSequence.current++
      setSelected(null)
      setReferences(null)
    }
  }
  return (
    <div className="min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{onSelect ? '选择媒体' : '媒体库'}</h1>
        <p className="text-muted-foreground text-sm">
          共{summary.total}个文件 · {bytes(summary.totalSize)}
        </p>
      </header>
      {writable && (
        <MediaUploadQueue
          initialFiles={initialFiles}
          folder={query.folder || '/'}
          imagesOnly={imagesOnly}
          onComplete={() => void latestLoad.current()}
          onBusyChange={setUploadBusy}
        />
      )}
      <div className="my-5 grid min-w-0 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-sm">
          搜索媒体
          <input
            aria-label="搜索媒体"
            className={control}
            maxLength={200}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="文件名或替代文本"
          />
        </label>
        <label className="min-w-0 text-sm">
          目录
          <select
            aria-label="媒体目录"
            className={control}
            value={query.folder}
            onChange={(event) => changeQuery({ folder: event.target.value, page: 1 })}
          >
            <option value="">全部目录</option>
            {summary.folders.map((folder) => (
              <option key={folder.path} value={folder.path}>
                {folder.path}（{folder.count}）
              </option>
            ))}
            {query.folder && !summary.folders.some((folder) => folder.path === query.folder) && (
              <option value={query.folder}>{query.folder}</option>
            )}
          </select>
        </label>
        <label className="text-sm">
          类型
          <select
            aria-label="媒体类型"
            className={control}
            value={query.kind}
            disabled={imagesOnly}
            onChange={(event) =>
              changeQuery({ kind: event.target.value as MediaQuery['kind'], page: 1 })
            }
          >
            <option value="">全部类型</option>
            <option value="IMAGE">图片</option>
            <option value="VIDEO">视频</option>
            <option value="DOCUMENT">文档</option>
          </select>
        </label>
      </div>
      {writable && (
        <form
          className="mb-5 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const folder = newFolder
            void run(async () => {
              const response = await api<{ path: string }>('/api/v1/admin/media/folders', {
                method: 'POST',
                body: JSON.stringify({ path: folder }),
              })
              if (!mounted.current) return
              setNewFolder('')
              setMessage('目录已创建。')
              changeQuery({ folder: response.data.path, page: 1 })
              void latestLoad.current()
            })
          }}
        >
          <label className="min-w-0 grow text-sm">
            新建目录
            <input
              aria-label="新目录路径"
              required
              maxLength={200}
              className={control}
              placeholder="/covers"
              value={newFolder}
              disabled={busy || uploadBusy}
              onChange={(event) => setNewFolder(event.target.value)}
            />
          </label>
          <button className={button} disabled={busy || uploadBusy || !newFolder}>
            新建目录
          </button>
        </form>
      )}
      {message && (
        <p role="status" className="my-4 rounded-lg border p-3 text-sm break-words">
          {message}
        </p>
      )}
      {loading && <p role="status">正在读取媒体…</p>}
      {writable && !onSelect && (
        <fieldset
          disabled={busy || uploadBusy}
          className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border p-4"
        >
          <legend className="text-sm">批量操作 · 已选{checked.size}/50</legend>
          <label className="text-sm">
            操作
            <select
              aria-label="媒体批量操作"
              className={control}
              value={action}
              onChange={(event) => setAction(event.target.value as typeof action)}
            >
              <option value="move">移动目录</option>
              <option value="alt">修改替代文本</option>
              <option value="delete">删除</option>
            </select>
          </label>
          {action === 'move' && (
            <label className="min-w-0 grow text-sm">
              目标目录
              <input
                aria-label="批量目标目录"
                className={control}
                value={target}
                maxLength={200}
                onChange={(event) => setTarget(event.target.value)}
                list="media-folder-options"
              />
            </label>
          )}
          {action === 'alt' && (
            <label className="min-w-0 grow text-sm">
              替代文本
              <input
                aria-label="批量替代文本"
                className={control}
                value={alt}
                maxLength={1000}
                onChange={(event) => setAlt(event.target.value)}
              />
            </label>
          )}
          <button
            type="button"
            className={button}
            disabled={busy || uploadBusy || !checked.size}
            onClick={batch}
          >
            {busy ? '正在处理…' : '执行批量操作'}
          </button>
          <button type="button" className={button} onClick={() => setChecked(new Set())}>
            清空选择
          </button>
        </fieldset>
      )}
      {!!results.length && (
        <ul aria-label="批量操作结果" className="mb-5 space-y-2 text-sm">
          {results.map((result) => (
            <li key={result.id} className="break-words">
              {result.id}：{result.success ? '成功' : '失败'} · {result.message}
            </li>
          ))}
        </ul>
      )}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <article key={item.id} className="min-w-0 overflow-hidden rounded-xl border">
            {writable && !onSelect && (
              <label className="flex items-center gap-2 p-3 text-sm">
                <input
                  type="checkbox"
                  aria-label={'选择媒体 ' + item.originalName}
                  checked={checked.has(item.id)}
                  disabled={busy || (!checked.has(item.id) && checked.size >= 50)}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setChecked((current) => {
                      const next = new Set(current)
                      if (enabled) next.add(item.id)
                      else next.delete(item.id)
                      return next
                    })
                  }}
                />
                选择
              </label>
            )}
            <button
              type="button"
              aria-label={'查看媒体 ' + item.originalName}
              className="w-full text-left"
              disabled={busy || loading}
              onClick={() => void openDetail(item)}
            >
              {item.kind === 'IMAGE' ? (
                <Image
                  unoptimized
                  src={item.url}
                  alt={item.alt ?? item.originalName}
                  width={item.width ?? 400}
                  height={item.height ?? 300}
                  className="bg-muted h-40 w-full object-contain"
                />
              ) : (
                <div className="bg-muted grid h-40 place-items-center text-3xl">
                  {item.kind === 'VIDEO' ? '▶' : 'PDF'}
                </div>
              )}
              <div className="p-4">
                <p className="truncate text-sm font-medium" title={item.originalName}>
                  {item.originalName}
                </p>
                <p className="text-muted-foreground mt-2 text-xs break-all">
                  {item.mimeType} · {bytes(item.size)} · {item.folder}
                </p>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {item.alt || '尚无替代文本'}
                </p>
              </div>
            </button>
          </article>
        ))}
      </div>
      {!loading && !items.length && (
        <p className="text-muted-foreground p-8 text-center">暂无匹配媒体。</p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className={button}
          disabled={loading || query.page <= 1}
          onClick={() => changeQuery({ page: query.page - 1 })}
        >
          上一页
        </button>
        <span className="text-sm">
          第{query.page} / {pages}页
        </span>
        <button
          type="button"
          className={button}
          disabled={loading || query.page >= pages}
          onClick={() => changeQuery({ page: query.page + 1 })}
        >
          下一页
        </button>
      </div>
      {writable && !onSelect && (
        <button
          type="button"
          className={button + ' mt-6'}
          disabled={busy || uploadBusy}
          onClick={() => {
            if (!confirm('清理过期临时上传，并重试失败的存储删除？')) return
            void run(async () => {
              const response = await api<{ cleaned: number; failed: number; pending: number }>(
                '/api/v1/admin/media/cleanup',
                { method: 'POST' },
              )
              if (mounted.current)
                setMessage(
                  '清理完成：成功' +
                    response.data.cleaned +
                    '，失败' +
                    response.data.failed +
                    '，仍待处理' +
                    response.data.pending +
                    '。',
                )
            })
          }}
        >
          清理临时文件与失败队列
        </button>
      )}
      <datalist id="media-folder-options">
        {summary.folders.map((folder) => (
          <option key={folder.path} value={folder.path} />
        ))}
      </datalist>
      <dialog
        ref={detail}
        aria-label="媒体详情"
        className="bg-background text-foreground m-auto max-h-[90vh] w-[calc(100%_-_24px)] max-w-xl overflow-auto rounded-xl border p-5 backdrop:bg-black/70"
        onCancel={(event) => {
          event.preventDefault()
          if (!locked.current) closeDetail()
        }}
        onClose={closeDetail}
      >
        {selected && (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold break-all">{selected.originalName}</h2>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={closeDetail}
                aria-label="关闭媒体详情"
              >
                关闭
              </button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">
              {selected.width && selected.height
                ? selected.width + '×' + selected.height + ' · '
                : ''}
              {bytes(selected.size)} · {selected.mimeType}
              {selected.createdAt
                ? ' · ' + new Date(selected.createdAt).toLocaleString('zh-CN')
                : ''}
            </p>
            <label className="mt-4 block text-sm">
              替代文本
              <input
                aria-label="媒体替代文本"
                className={control}
                maxLength={1000}
                value={selected.alt ?? ''}
                disabled={busy || (!writable && !onSelect)}
                onChange={(event) => setSelected({ ...selected, alt: event.target.value || null })}
              />
            </label>
            {onSelect && (
              <p className="text-muted-foreground mt-2 text-sm">
                图片需要可读描述；选择时的描述用于插入内容，保存媒体信息才会更新媒体库。
              </p>
            )}
            <label className="mt-4 block text-sm">
              逻辑目录
              <input
                aria-label="媒体逻辑目录"
                className={control}
                maxLength={200}
                value={selected.folder}
                disabled={busy || !writable}
                list="media-folder-options"
                onChange={(event) => setSelected({ ...selected, folder: event.target.value })}
              />
            </label>
            <section aria-label="媒体引用来源" className="mt-4 text-sm">
              <h3 className="font-semibold">引用来源（包含已删除内容）</h3>
              {references === null ? (
                <p>正在核查引用…</p>
              ) : references.length ? (
                <ul className="mt-2 space-y-2">
                  {references.map((ref, index) => (
                    <li key={index} className="break-words">
                      {ref.type}：{ref.title}（{ref.field}）
                    </li>
                  ))}
                </ul>
              ) : (
                <p>暂无内容引用。</p>
              )}
            </section>
            <div className="mt-5 flex flex-wrap gap-3">
              <a className={button} href={selected.url} target="_blank" rel="noopener noreferrer">
                查看原文件 ↗
              </a>
              <button
                type="button"
                className={button}
                onClick={() => {
                  void navigator.clipboard.writeText(selected.url).then(
                    () => setMessage('已复制地址'),
                    () => setMessage('复制失败，可通过查看原文件复制地址。'),
                  )
                }}
              >
                复制地址
              </button>
              {onSelect && (
                <button
                  type="button"
                  className={button}
                  disabled={
                    busy || uploadBusy || (selected.kind === 'IMAGE' && !selected.alt?.trim())
                  }
                  onClick={() => onSelect(selected)}
                >
                  选择此文件
                </button>
              )}
              {writable && (
                <>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || uploadBusy}
                    onClick={() => {
                      const item = selected
                      void run(async () => {
                        await api('/api/v1/admin/media/' + item.id, {
                          method: 'PATCH',
                          body: JSON.stringify({ alt: item.alt || null, folder: item.folder }),
                        })
                        if (mounted.current) {
                          setMessage('媒体信息已保存。')
                          detailSequence.current++
                          setSelected(null)
                          void latestLoad.current()
                        }
                      })
                    }}
                  >
                    保存媒体信息
                  </button>
                  <button
                    type="button"
                    className={button + ' text-destructive'}
                    disabled={busy || uploadBusy || references === null || !!references.length}
                    onClick={() => {
                      const item = selected
                      if (!confirm('永久删除未引用的媒体文件？此操作不可恢复。')) return
                      void run(async () => {
                        try {
                          const response = await api<{ cleanupPending: boolean }>(
                            '/api/v1/admin/media/' + item.id,
                            { method: 'DELETE' },
                          )
                          if (mounted.current) {
                            setMessage(
                              response.data.cleanupPending
                                ? '媒体记录已删除，存储清理待重试；原地址可能仍可访问。'
                                : '媒体文件已删除。',
                            )
                            setSelected(null)
                            setChecked((current) => {
                              const next = new Set(current)
                              next.delete(item.id)
                              return next
                            })
                            void latestLoad.current()
                          }
                        } catch (error) {
                          if (mounted.current) setMessage(errorMessage(error))
                        }
                      })
                    }}
                  >
                    删除媒体
                  </button>
                </>
              )}
            </div>
            {message && (
              <p role="status" className="mt-4 text-sm break-words">
                {message}
              </p>
            )}
          </>
        )}
      </dialog>
    </div>
  )
}
