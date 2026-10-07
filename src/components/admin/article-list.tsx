'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { formatDate } from '@/lib/utils'
import { useAdminUser } from './shell'
type Row = { id: string; title: string; revision: number; status: string; updatedAt: string }
/** 列表与回收站共用修订锁，彻底删除要求再次输入标题。 */
export function ArticleList({ trash = false }: { trash?: boolean }) {
  const user = useAdminUser()
  const writable = user?.permissions.includes('content:write')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const load = async () => {
    try {
      const result = await api<Row[]>(
        `/api/v1/admin/articles?includeDeleted=${trash}&q=${encodeURIComponent(query)}&status=${status}&page=${page}`,
      )
      setRows(result.data)
      setPages(result.meta?.totalPages ?? 1)
      setError('')
    } catch (error) {
      setError((error as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [trash, query, status, page]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (row: Row, action: 'delete' | 'restore' | 'purge') => {
    if (
      action === 'purge'
        ? prompt(`彻底删除不可恢复，请输入标题：${row.title}`) !== row.title
        : !confirm(action === 'restore' ? '恢复这篇文章？' : '将这篇文章移入回收站？')
    )
      return
    try {
      await api(`/api/v1/admin/articles/${row.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'restore' ? 'POST' : 'DELETE',
        body: JSON.stringify({ revision: row.revision }),
      })
      await load()
    } catch (error) {
      setError((error as Error).message)
    }
  }
  return (
    <div>
      <header className="flex flex-wrap justify-between gap-4">
        <h1 className="text-2xl font-bold">{trash ? '文章回收站' : '文章管理'}</h1>
        <div className="flex gap-4">
          <Link href={trash ? '/admin/articles' : '/admin/articles/trash'}>
            {trash ? '返回列表' : '回收站'}
          </Link>
          {writable && (
            <Link href="/admin/articles/new" className="text-brand">
              新建文章 +
            </Link>
          )}
        </div>
      </header>
      <div className="my-6 flex gap-3">
        <input
          aria-label="筛选文章"
          placeholder="搜索标题"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          className="min-w-0 flex-1 rounded-lg border bg-transparent p-2"
        />
        <select
          aria-label="状态"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setPage(1)
          }}
        >
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PUBLISHED">已发布</option>
          <option value="ARCHIVED">已归档</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-destructive my-4">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
          >
            <div>
              <Link href={`/admin/articles/${row.id}`} className="font-semibold">
                {row.title}
              </Link>
              <p className="text-muted-foreground mt-2 text-xs">
                {row.status} · 更新 {formatDate(row.updatedAt)} · v{row.revision}
              </p>
            </div>
            <div className="flex gap-4 text-sm">
              {writable &&
                (trash ? (
                  <>
                    <button onClick={() => act(row, 'restore')}>恢复</button>
                    <button
                      className="text-destructive"
                      disabled={user?.role !== 'ADMIN'}
                      onClick={() => act(row, 'purge')}
                    >
                      彻底删除
                    </button>
                  </>
                ) : (
                  <>
                    <Link href={`/admin/articles/${row.id}`}>编辑</Link>
                    <button className="text-destructive" onClick={() => act(row, 'delete')}>
                      删除
                    </button>
                  </>
                ))}
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-muted-foreground p-8 text-center">暂无文章</p>}
      </div>
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
    </div>
  )
}
