'use client'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { uploadMedia, type MediaItem } from '@/lib/api/upload'
import { useAdminUser } from './shell'
/** 引用信息先显示给用户，删除保护仍由服务端事务重新核验。 */
export function MediaLibrary() {
  const user = useAdminUser()
  const writable = user?.permissions.includes('media:write')
  const [items, setItems] = useState<MediaItem[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState('')
  const [folder, setFolder] = useState('/')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const load = async () => {
    try {
      const { data, meta } = await api<MediaItem[]>(
        `/api/v1/admin/media?kind=${kind}&page=${page}&folder=${encodeURIComponent(folder)}`,
      )
      setItems(data)
      setPages(meta?.totalPages ?? 1)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [page, folder, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <header className="flex flex-wrap justify-between gap-4">
        <h1 className="text-2xl font-bold">媒体库</h1>
        {writable && (
          <label className="bg-primary text-primary-foreground cursor-pointer rounded-lg px-4 py-2 text-sm">
            {busy ? '正在上传…' : '上传文件 +'}
            <input
              aria-label="上传文件"
              type="file"
              multiple
              disabled={busy}
              className="sr-only"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,application/pdf"
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                setBusy(true)
                try {
                  for (const file of files) await uploadMedia(file, { folder })
                  setMessage(`已上传 ${files.length} 个文件`)
                  await load()
                } catch (error) {
                  setMessage((error as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            />
          </label>
        )}
      </header>
      <p className="text-muted-foreground mt-3 text-sm">
        图片≤10MB，视频≤50MB，PDF≤20MB。已引用文件不能删除。
      </p>
      <div className="my-6 flex flex-wrap gap-4">
        <label className="text-sm">
          目录
          <input
            value={folder}
            onChange={(event) => {
              setFolder(event.target.value)
              setPage(1)
            }}
            className="ml-2 rounded-lg border bg-transparent p-2"
          />
        </label>
        <select
          aria-label="媒体类型"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value)
            setPage(1)
          }}
        >
          <option value="">全部类型</option>
          <option value="IMAGE">图片</option>
          <option value="VIDEO">视频</option>
          <option value="DOCUMENT">文档</option>
        </select>
      </div>
      {message && (
        <p role="status" className="my-4 rounded-lg border p-3 text-sm">
          {message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <button
            key={item.id}
            className="overflow-hidden rounded-xl border text-left"
            onClick={() => setSelected(item)}
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
              <p className="truncate text-sm font-medium">{item.originalName}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                {item.mimeType} · {(item.size / 1024).toFixed(1)}KB
              </p>
            </div>
          </button>
        ))}
      </div>
      {!items.length && <p className="text-muted-foreground p-8 text-center">目录内暂无媒体</p>}
      <div className="mt-6 flex justify-between">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <span>
          {page} / {Math.max(1, pages)}
        </span>
        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
      </div>
      {selected && (
        <div className="bg-background/80 fixed inset-0 z-50 grid place-items-center overflow-auto p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="媒体详情"
            className="bg-background w-full max-w-lg rounded-xl border p-6"
          >
            <div className="flex justify-between gap-4">
              <h2 className="font-semibold break-all">{selected.originalName}</h2>
              <button onClick={() => setSelected(null)} aria-label="关闭媒体详情">
                ✕
              </button>
            </div>
            <label className="mt-5 block text-sm">
              替代文本
              <input
                value={selected.alt ?? ''}
                disabled={!writable}
                onChange={(event) => setSelected({ ...selected, alt: event.target.value })}
                className="mt-2 w-full rounded-lg border bg-transparent p-2"
              />
            </label>
            <label className="mt-5 block text-sm">
              逻辑目录
              <input
                value={selected.folder}
                disabled={!writable}
                onChange={(event) => setSelected({ ...selected, folder: event.target.value })}
                className="mt-2 w-full rounded-lg border bg-transparent p-2"
              />
            </label>
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
              <a href={selected.url} target="_blank" rel="noopener noreferrer">
                查看原文件 ↗
              </a>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.url)
                    setMessage('已复制地址')
                  } catch {
                    setMessage(`文件地址：${selected.url}`)
                  }
                }}
              >
                复制地址
              </button>
              <button
                onClick={async () => {
                  try {
                    const { data } = await api<{ type: string; title: string; field: string }[]>(
                      `/api/v1/admin/media/${selected.id}/references`,
                    )
                    setMessage(
                      data.length
                        ? data.map((ref) => `${ref.type}：${ref.title}（${ref.field}）`).join('；')
                        : '暂无内容引用',
                    )
                  } catch (error) {
                    setMessage((error as Error).message)
                  }
                }}
              >
                查看引用
              </button>
              {writable && (
                <>
                  <button
                    onClick={async () => {
                      try {
                        await api(`/api/v1/admin/media/${selected.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            alt: selected.alt || null,
                            folder: selected.folder,
                          }),
                        })
                        setMessage('媒体信息已保存')
                        setSelected(null)
                        await load()
                      } catch (error) {
                        setMessage((error as Error).message)
                      }
                    }}
                  >
                    保存
                  </button>
                  <button
                    className="text-destructive"
                    onClick={async () => {
                      if (!confirm('删除未引用的媒体文件？此操作不可恢复。')) return
                      try {
                        const { data } = await api<{ cleanupPending: boolean }>(
                          `/api/v1/admin/media/${selected.id}`,
                          { method: 'DELETE' },
                        )
                        setMessage(
                          data.cleanupPending
                            ? '媒体记录已删除，存储文件清理失败，已进入重试队列；原公开地址可能仍可访问。'
                            : '媒体文件已删除',
                        )
                        setSelected(null)
                        await load()
                      } catch (error) {
                        setMessage((error as Error).message)
                      }
                    }}
                  >
                    删除
                  </button>
                </>
              )}
            </div>
            {message && (
              <p role="status" className="mt-4 rounded-lg border p-3 text-sm">
                {message}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
