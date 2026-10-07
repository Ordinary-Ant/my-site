'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { pinyin } from 'pinyin-pro'
import { api, ClientError } from '@/lib/api/client'
import { useAdminUser } from './shell'
const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p>加载编辑器…</p>,
})
type Draft = {
  title: string
  slug: string
  content: string
  summary: string
  coverImage: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  publishedAt: string
  isTop: boolean
  order: number
  allowComment: boolean
  categoryId: string
  tagIds: string[]
  seoTitle: string
  seoDescription: string
  seoKeywords: string
  ogImage: string
}
type Article = Omit<Draft, 'publishedAt'> & {
  id: string
  revision: number
  publishedAt: string | null
  tags: { id: string }[]
}
const empty: Draft = {
  title: '',
  slug: '',
  content: '',
  summary: '',
  coverImage: '',
  status: 'DRAFT',
  publishedAt: '',
  isTop: false,
  order: 0,
  allowComment: true,
  categoryId: '',
  tagIds: [],
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
  ogImage: '',
}
const fields = [
  'summary',
  'coverImage',
  'seoTitle',
  'seoDescription',
  'seoKeywords',
  'ogImage',
] as const
/** 同一编辑会话串行保存，revision冲突停止自动保存并保留本地原稿。 */
export function ArticleEditor({ id }: { id?: string }) {
  const user = useAdminUser()
  const writable = user?.permissions.includes('content:write')
  const [draft, setDraft] = useState<Draft>(empty)
  const [revision, setRevision] = useState(1)
  const [currentId, setCurrentId] = useState(id)
  const [ready, setReady] = useState(!id)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const [local, setLocal] = useState<{ draft: Draft; revision: number } | null>(null)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const draftRef = useRef(draft)
  const versionRef = useRef(revision)
  const idRef = useRef(currentId)
  const saving = useRef(false)
  const blocked = useRef(false)
  const lastSaved = useRef(JSON.stringify(empty))
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const storageKey = `article-draft:${user?.id ?? 'pending'}:${currentId ?? 'new'}`
  const fromArticle = (article: Article): Draft =>
    ({
      ...empty,
      ...Object.fromEntries(
        Object.keys(empty).map((key) => [
          key,
          article[key as keyof Article] ?? empty[key as keyof Draft],
        ]),
      ),
      tagIds: article.tags.map((tag) => tag.id),
      publishedAt: article.publishedAt
        ? new Date(article.publishedAt).toISOString().slice(0, 16)
        : '',
    }) as Draft
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (id) {
          const { data } = await api<Article>(`/api/v1/admin/articles/${id}`)
          if (!active) return
          const value = fromArticle(data)
          setDraft(value)
          draftRef.current = value
          setRevision(data.revision)
          versionRef.current = data.revision
          lastSaved.current = JSON.stringify(value)
        }
        const saved = localStorage.getItem(storageKey)
        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            if (parsed.draft && typeof parsed.draft.content === 'string')
              setLocal({
                draft: parsed.draft,
                revision: Number.isInteger(parsed.revision) ? parsed.revision : 0,
              })
          } catch {
            localStorage.removeItem(storageKey)
          }
        }
        if (active) setReady(true)
      } catch (error) {
        if (active) setMessage((error as Error).message)
      }
    })()
    void api<{ categories: { id: string; name: string }[]; tags: { id: string; name: string }[] }>(
      '/api/v1/admin/articles/options',
    )
      .then(({ data }) => {
        if (active) {
          setCategories(data.categories)
          setTags(data.tags)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [id, storageKey])
  useEffect(() => {
    draftRef.current = draft
    if (!ready) return
    const timer = setTimeout(() => {
      if (JSON.stringify(draft) !== lastSaved.current)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ draft, revision: versionRef.current, savedAt: Date.now() }),
        )
    }, 3000)
    return () => clearTimeout(timer)
  }, [draft, ready, storageKey])
  const save = async (status?: Draft['status'], silent = false) => {
    if (!writable || saving.current || blocked.current) return
    const snapshot = { ...draftRef.current, ...(status ? { status } : {}) }
    if (
      silent &&
      (snapshot.status !== 'DRAFT' ||
        !idRef.current ||
        JSON.stringify(snapshot) === lastSaved.current)
    )
      return
    saving.current = true
    const sentRevision = versionRef.current
    setBusy(true)
    try {
      const body = {
        ...snapshot,
        slug: snapshot.slug || undefined,
        publishedAt: snapshot.publishedAt
          ? new Date(`${snapshot.publishedAt}:00Z`).toISOString()
          : null,
        categoryId: snapshot.categoryId || null,
        ...Object.fromEntries(fields.map((key) => [key, snapshot[key] || null])),
        ...(idRef.current ? { revision: versionRef.current } : {}),
      }
      const { data } = await api<Article>(
        `/api/v1/admin/articles${idRef.current ? `/${idRef.current}` : ''}`,
        { method: idRef.current ? 'PATCH' : 'POST', body: JSON.stringify(body), keepalive: silent },
      )
      idRef.current = data.id
      setCurrentId(data.id)
      versionRef.current = data.revision
      setRevision(data.revision)
      const savedDraft = fromArticle(data)
      lastSaved.current = JSON.stringify(savedDraft)
      // 请求期间继续输入时只更新服务端产生的slug/状态，不覆盖正在编辑的正文。
      const editing = draftRef.current
      const nextDraft =
        JSON.stringify(editing) === JSON.stringify({ ...snapshot, status: editing.status })
          ? savedDraft
          : { ...editing, slug: editing.slug || data.slug, ...(status ? { status } : {}) }
      // 导航/存储key变化触发清理前同步ref，不能把刚保存的旧快照再自动写一次。
      draftRef.current = nextDraft
      if (JSON.stringify(nextDraft) !== lastSaved.current) {
        const backup = JSON.stringify({ draft: nextDraft, revision: data.revision })
        localStorage.setItem(storageKey, backup)
        localStorage.setItem(`article-draft:${user?.id}:${data.id}`, backup)
      } else {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
          try {
            const backup = JSON.parse(stored)
            if (
              backup.revision === sentRevision &&
              JSON.stringify({ ...backup.draft, status: snapshot.status }) ===
                JSON.stringify(snapshot)
            )
              localStorage.removeItem(storageKey)
          } catch {
            /* 无法识别的备份保留，避免误删。 */
          }
        }
      }
      if (mounted.current) {
        setDraft(nextDraft)
        setMessage(`${silent ? '自动保存' : '保存成功'} · v${data.revision}`)
        if (!id) history.replaceState(null, '', `/admin/articles/${data.id}`)
      }
    } catch (error) {
      setMessage((error as Error).message)
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: draftRef.current, revision: versionRef.current }),
      )
      if (error instanceof ClientError && error.status === 409) {
        blocked.current = true
        setConflict(true)
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const persist = () => {
      if (writable && JSON.stringify(draftRef.current) !== lastSaved.current)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ draft: draftRef.current, revision: versionRef.current }),
        )
    }
    const dirty = () =>
      writable &&
      !!(draftRef.current.title || draftRef.current.content) &&
      JSON.stringify(draftRef.current) !== lastSaved.current
    const unload = (event: BeforeUnloadEvent) => {
      persist()
      if (dirty()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        new URL(link.href).pathname === location.pathname ||
        !dirty()
      )
        return
      persist()
      if (!confirm('内容尚未保存到服务器，已保留本地草稿。确定离开？')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', navigate, true)
    return () => {
      persist()
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', navigate, true)
    }
  }, [storageKey, writable])
  useEffect(() => {
    const timer = setInterval(() => void saveRef.current(undefined, true), 60000)
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ draft: draftRef.current, revision: versionRef.current }),
        )
        void saveRef.current(undefined, true)
      }
    }
    document.addEventListener('visibilitychange', hide)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', hide)
      if (idRef.current && draftRef.current.status === 'DRAFT')
        void saveRef.current(undefined, true)
    }
  }, [storageKey])
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  if (!ready) return <p aria-live="polite">{message || '加载文章…'}</p>
  if (!writable)
    return (
      <div>
        <Link href="/admin/articles">← 文章列表</Link>
        <h1 className="my-6 text-2xl font-bold">{draft.title || '只读访问'}</h1>
        <p className="text-muted-foreground mb-4">当前账号只能读取内容。</p>
        <textarea
          aria-label="只读正文"
          readOnly
          value={draft.content}
          className="min-h-96 w-full rounded-xl border bg-transparent p-4 font-mono text-sm"
        />
      </div>
    )
  return (
    <div>
      <header className="mb-6 flex flex-wrap justify-between gap-4">
        <div>
          <Link href="/admin/articles" className="text-muted-foreground text-sm">
            ← 文章列表
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{currentId ? '编辑文章' : '新建文章'}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {draft.status} · v{revision}
          </span>
          <button
            disabled={busy || conflict}
            onClick={() => save('DRAFT')}
            className="rounded-lg border px-4 py-2"
          >
            保存草稿
          </button>
          <button
            disabled={!currentId || busy}
            onClick={async () => {
              try {
                const { data } = await api<{ url: string }>(
                  `/api/v1/admin/articles/${idRef.current}/preview-token`,
                  { method: 'POST' },
                )
                window.open(data.url, '_blank', 'noopener,noreferrer')
              } catch (error) {
                setMessage((error as Error).message)
              }
            }}
          >
            预览已保存内容 ↗
          </button>
          <button
            disabled={busy || conflict}
            onClick={() => save('PUBLISHED')}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
          >
            {draft.publishedAt && new Date(`${draft.publishedAt}:00Z`) > new Date()
              ? '定时发布'
              : '发布文章'}
          </button>
        </div>
      </header>
      {message && (
        <p role="status" className="mb-4 rounded-lg border p-3 text-sm">
          {message}
        </p>
      )}
      {conflict && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-500 p-4">
          版本冲突，自动保存已停止，本地原稿仍保留。
          <button
            onClick={async () => {
              const { data } = await api<Article>(`/api/v1/admin/articles/${idRef.current}`)
              setMessage(`最新版本 v${data.revision}：${data.content}`)
            }}
            className="ml-3 underline"
          >
            查看服务器最新正文
          </button>
          <button onClick={() => location.reload()} className="ml-3 underline">
            重新加载并比较本地草稿
          </button>
          <button
            className="ml-3 underline"
            onClick={async () => {
              try {
                const { data } = await api<Article>('/api/v1/admin/articles', {
                  method: 'POST',
                  body: JSON.stringify({
                    title: `${draft.title}（冲突副本）`,
                    content: draft.content,
                    summary: draft.summary || null,
                    status: 'DRAFT',
                    tagIds: draft.tagIds,
                  }),
                })
                location.assign(`/admin/articles/${data.id}`)
              } catch (error) {
                setMessage((error as Error).message)
              }
            }}
          >
            将本地正文另存新草稿
          </button>
        </div>
      )}
      {local && (
        <div className="mb-5 rounded-lg border p-4 text-sm">
          发现未保存的本地草稿。
          <button
            className="ml-3 underline"
            onClick={() => {
              const serverRevision = versionRef.current
              setDraft(local.draft)
              // 原稿版本同时用于后续本地持久化，二次重载也不得隐式升级。
              versionRef.current = local.revision
              setRevision(local.revision)
              if (local.revision !== serverRevision) {
                blocked.current = true
                setConflict(true)
                setMessage(
                  `本地稿基于v${local.revision}，服务器为v${serverRevision}；已停止自动保存，请比较或另存。`,
                )
              }
              setLocal(null)
            }}
          >
            恢复正文
          </button>
          <button
            className="ml-3 underline"
            onClick={() => {
              setLocal(null)
              localStorage.removeItem(storageKey)
            }}
          >
            丢弃本地草稿
          </button>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-5">
          <label className="block">
            文章标题
            <input
              aria-label="文章标题"
              value={draft.title}
              maxLength={200}
              onChange={(event) => change('title', event.target.value)}
              className="mt-2 w-full rounded-lg border bg-transparent p-3 text-xl"
            />
          </label>
          <label className="block text-sm">
            摘要
            <textarea
              aria-label="摘要"
              value={draft.summary}
              maxLength={500}
              onChange={(event) => change('summary', event.target.value)}
              className="mt-2 w-full rounded-lg border bg-transparent p-3"
            />
          </label>
          <MarkdownEditor value={draft.content} onChange={(value) => change('content', value)} />
        </div>
        <aside className="space-y-5 rounded-xl border p-4 text-sm">
          <label className="block">
            文章路径
            <input
              value={draft.slug}
              onChange={(event) => change('slug', event.target.value)}
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
            <button
              className="text-brand mt-2"
              onClick={() =>
                change(
                  'slug',
                  pinyin(draft.title, { toneType: 'none', type: 'array' })
                    .join('-')
                    .toLowerCase()
                    .replace(/[^a-z0-9-]+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, ''),
                )
              }
            >
              从标题生成
            </button>
            <button
              className="text-brand ml-3"
              onClick={async () => {
                try {
                  const { data } = await api<{ available: boolean }>(
                    `/api/v1/admin/articles/slug-available?slug=${encodeURIComponent(draft.slug)}${currentId ? `&excludeId=${currentId}` : ''}`,
                  )
                  setMessage(data.available ? '路径可用，最终以保存校验为准' : '路径已被使用')
                } catch (error) {
                  setMessage((error as Error).message)
                }
              }}
            >
              检查
            </button>
          </label>
          <label className="block">
            分类
            <select
              value={draft.categoryId}
              onChange={(event) => change('categoryId', event.target.value)}
              className="bg-background mt-2 w-full rounded-lg border p-2"
            >
              <option value="">无分类</option>
              {categories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>标签（最多10个）</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label key={tag.id}>
                  <input
                    type="checkbox"
                    checked={draft.tagIds.includes(tag.id)}
                    onChange={(event) =>
                      change(
                        'tagIds',
                        event.target.checked
                          ? [...draft.tagIds, tag.id]
                          : draft.tagIds.filter((id) => id !== tag.id),
                      )
                    }
                  />{' '}
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            发布时间（UTC）
            <input
              type="datetime-local"
              value={draft.publishedAt}
              onChange={(event) => change('publishedAt', event.target.value)}
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
          </label>
          <label className="block">
            封面地址
            <input
              value={draft.coverImage}
              onChange={(event) => change('coverImage', event.target.value)}
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={draft.isTop}
              onChange={(event) => change('isTop', event.target.checked)}
            />{' '}
            置顶
          </label>
          <label className="block">
            人工顺序
            <input
              type="number"
              min={0}
              value={draft.order}
              onChange={(event) => change('order', Number(event.target.value))}
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={draft.allowComment}
              onChange={(event) => change('allowComment', event.target.checked)}
            />{' '}
            允许评论
          </label>
          <details>
            <summary>SEO设置</summary>
            {(['seoTitle', 'seoDescription', 'seoKeywords', 'ogImage'] as const).map((key) => (
              <label key={key} className="mt-3 block">
                {key}
                <input
                  value={draft[key]}
                  onChange={(event) => change(key, event.target.value)}
                  className="mt-2 w-full rounded-lg border bg-transparent p-2"
                />
              </label>
            ))}
          </details>
        </aside>
      </div>
    </div>
  )
}
