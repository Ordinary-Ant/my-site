'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { api, ClientError } from '@/lib/api/client'
import { uploadMedia } from '@/lib/api/upload'
import { chinaToday, LOG_TYPES, MOODS, WEATHER } from '@/lib/log-display'
import { LogCreateSchema, LogUpdateSchema } from '@/lib/validators/log'
import { useAdminUser } from './shell'
const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p>加载编辑器…</p>,
})

type Draft = {
  title: string
  content: string
  logDate: string
  type: string
  summary: string
  mood: string
  weather: string
  location: string
  coverImage: string
  images: string[]
  tagIds: string[]
  status: string
  publishedAt: string
  isPinned: boolean
}
type LogRecord = Omit<Draft, 'tagIds'> & { id: string; revision: number; tags: { id: string }[] }
const empty = (): Draft => ({
  title: '',
  content: '',
  logDate: chinaToday(),
  type: 'DAILY',
  summary: '',
  mood: '',
  weather: '',
  location: '',
  coverImage: '',
  images: [],
  tagIds: [],
  status: 'PUBLISHED',
  publishedAt: '',
  isPinned: false,
})
const fromLog = (item: LogRecord): Draft => ({
  ...empty(),
  title: item.title,
  content: item.content,
  type: item.type,
  images: item.images,
  status: item.status,
  isPinned: item.isPinned,
  logDate: item.logDate.slice(0, 10),
  summary: item.summary ?? '',
  mood: item.mood ?? '',
  weather: item.weather ?? '',
  location: item.location ?? '',
  coverImage: item.coverImage ?? '',
  tagIds: item.tags.map((tag) => tag.id),
  // 保存完整时间精度，只有用户改动时间控件时才转换北京时间。
  publishedAt: item.publishedAt ?? '',
})
const control =
  'bg-background aria-invalid:border-destructive mt-2 w-full rounded-lg border px-3 py-2'

/** 快速记录与完整表单共用版本锁；冲突保留本地稿，不自动重试覆盖服务器内容。 */
export function LogEditor({
  id,
  onSaved,
  quick = false,
}: {
  id?: string
  onSaved?: () => void
  quick?: boolean
}) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('content:write')
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const [fieldErrors, setFieldErrors] = useState<{ path: string; message: string }[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [currentId, setCurrentId] = useState(id)
  const [revision, setRevision] = useState(1)
  const [ready, setReady] = useState(!id)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState('')
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [recovery, setRecovery] = useState<{ draft: Draft; revision: number } | null>(null)
  const current = useRef({ draft, revision, currentId, conflict })
  const lastSaved = useRef('')
  const saving = useRef(false)
  const storageKey = `log-draft:${user?.id ?? 'pending'}:${currentId ?? 'new'}`
  current.current = { draft, revision, currentId, conflict }
  const update = (key: keyof Draft, value: unknown) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  const payload = (value: Draft) => ({
    ...value,
    summary: value.summary || null,
    mood: value.mood || null,
    weather: value.weather || null,
    location: value.location || null,
    coverImage: value.coverImage || null,
    publishedAt: value.publishedAt || null,
  })
  const focusIssue = (path: string) => {
    path = path.split('.')[0]
    if (!(path in empty())) return
    const named = form.current?.elements.namedItem(path)
    const target =
      named instanceof HTMLElement
        ? named
        : form.current?.querySelector<HTMLElement>(
            '[data-log-field="' +
              path +
              '"] textarea, [data-log-field="' +
              path +
              '"] [contenteditable="true"], [data-log-field="' +
              path +
              '"]',
          )
    if (target) {
      const details = target.closest('details')
      if (details) details.open = true
      target.scrollIntoView({ block: 'center' })
      target.focus()
    }
  }
  useEffect(() => {
    if (!form.current) return
    for (const field of Array.from(form.current.elements))
      if (field instanceof HTMLElement && field.getAttribute('name')) {
        field.setAttribute(
          'aria-invalid',
          String(fieldErrors.some((error) => error.path === field.getAttribute('name'))),
        )
      }
  }, [fieldErrors])
  useEffect(() => {
    if (!user) return
    let active = true
    void api<{ tags: { id: string; name: string }[] }>('/api/v1/admin/articles/options')
      .then(({ data }) => {
        if (active) setTags(data.tags)
      })
      .catch(() => {})
    if (id)
      void api<LogRecord>('/api/v1/admin/logs/' + id)
        .then(({ data }) => {
          if (active) {
            const next = fromLog(data)
            setDraft(next)
            setRevision(data.revision)
            lastSaved.current = JSON.stringify(next)
            setReady(true)
          }
        })
        .catch((error: Error) => {
          if (active) setMessage(error.message)
        })
    else lastSaved.current = JSON.stringify(empty())
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) setRecovery(JSON.parse(saved))
    } catch {
      setMessage('本地稿读取失败，可重新编辑')
    }
    return () => {
      active = false
    }
  }, [id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const keepLocal = () => {
    if (!writable || !ready || JSON.stringify(current.current.draft) === lastSaved.current) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: current.current.draft, revision: current.current.revision }),
      )
    } catch {
      setMessage('本地空间不足，请先保存或复制正文')
    }
  }
  const save = async (makeCopy = false, automatic = false, forceStatus?: string) => {
    if (!writable || !ready || saving.current || (current.current.conflict && !makeCopy)) return
    const snapshot = { ...current.current.draft },
      version = current.current.revision,
      target = makeCopy ? undefined : current.current.currentId
    if (makeCopy) snapshot.status = 'DRAFT'
    else if (forceStatus) snapshot.status = forceStatus
    const body = { ...payload(snapshot), ...(target ? { revision: version } : {}) }
    const validation = (target ? LogUpdateSchema : LogCreateSchema).safeParse(body)
    if (!validation.success) {
      if (!automatic) {
        const issues = validation.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
        setFieldErrors(issues)
        setMessage('请修正日志字段后保存')
        focusIssue(issues[0].path)
      }
      return
    }
    saving.current = true
    setFieldErrors([])
    setBusy(true)
    try {
      const { data } = await api<LogRecord>('/api/v1/admin/logs' + (target ? '/' + target : ''), {
        method: target ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      const nextDraft = fromLog(data)
      // 同步更新引用，抽屉立即卸载时也不会重新写入已保存的旧稿。
      current.current = {
        draft: nextDraft,
        revision: data.revision,
        currentId: data.id,
        conflict: false,
      }
      setDraft(nextDraft)
      setCurrentId(data.id)
      setRevision(data.revision)
      setConflict(false)
      lastSaved.current = JSON.stringify(nextDraft)
      try {
        localStorage.removeItem(storageKey)
      } catch {}
      setRecovery(null)
      setMessage(makeCopy ? '已另存为新草稿' : '日志已保存')
      onSaved?.()
    } catch (error) {
      if (error instanceof ClientError && error.status === 409) {
        setConflict(true)
        setMessage('服务器已有更新，已保留本地稿。请复制内容或另存新草稿。')
      } else {
        setMessage((error as Error).message)
        if (error instanceof ClientError && error.details) {
          setFieldErrors(error.details)
          requestAnimationFrame(() => {
            focusIssue(error.details![0]?.path ?? '')
          })
        }
      }
      keepLocal()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!ready || !writable) return
    const timer = setTimeout(keepLocal, 3000)
    return () => clearTimeout(timer)
  }, [draft, revision, ready, writable, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || !writable) return
    const timer = setInterval(() => {
      if (
        current.current.draft.status === 'DRAFT' &&
        JSON.stringify(current.current.draft) !== lastSaved.current
      )
        void save(false, true)
    }, 60000)
    const leave = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(current.current.draft) !== lastSaved.current) {
        keepLocal()
        event.preventDefault()
      }
    }
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void save(false, false, 'PUBLISHED')
      } else if (event.key === 'Escape' && !quick && !saving.current) {
        event.preventDefault()
        if (
          JSON.stringify(current.current.draft) === lastSaved.current ||
          confirm('日志尚未保存，已保留本地稿。确定返回列表？')
        ) {
          keepLocal()
          void (async () => {
            if (current.current.draft.status === 'DRAFT') await save(false, true)
            router.push('/admin/logs')
          })()
        }
      }
    }
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        new URL(link.href).pathname === location.pathname ||
        JSON.stringify(current.current.draft) === lastSaved.current
      )
        return
      event.preventDefault()
      event.stopPropagation()
      keepLocal()
      if (!confirm('日志尚未保存到服务器，已保留本地稿。确定离开？')) return
      void (async () => {
        if (current.current.draft.status === 'DRAFT') await save(false, true)
        if (new URL(link.href).origin === location.origin) router.push(link.href)
        else location.assign(link.href)
      })()
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        keepLocal()
        if (
          current.current.draft.status === 'DRAFT' &&
          JSON.stringify(current.current.draft) !== lastSaved.current
        )
          void save(false, true)
      }
    }
    const editorUrl = location.href
    const editorHistory = history.state
    const pop = (event: PopStateEvent) => {
      if (
        location.href === editorUrl ||
        JSON.stringify(current.current.draft) === lastSaved.current
      )
        return
      keepLocal()
      if (!confirm('日志尚未保存到服务器，已保留本地稿。确定离开？')) {
        // popstate不可取消，先阻止路由消费，再回到编辑页的历史记录。
        event.stopImmediatePropagation()
        history.pushState(editorHistory, '', editorUrl)
      } else if (current.current.draft.status === 'DRAFT') void save(false, true)
    }
    window.addEventListener('beforeunload', leave)
    window.addEventListener('keydown', keys)
    document.addEventListener('click', navigate, true)
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('popstate', pop, true)
    return () => {
      clearInterval(timer)
      keepLocal()
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('keydown', keys)
      document.removeEventListener('click', navigate, true)
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('popstate', pop, true)
    }
  }, [ready, writable, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files: FileList | null) => {
    if (!files || busy) return
    if (draft.images.length + files.length > 100) {
      setMessage('图集最多100张，请减少本次选择数量')
      return
    }
    // 上传期间同样锁住快捷键保存，避免保存旧图集覆盖正在上传的结果。
    saving.current = true
    setBusy(true)
    try {
      const images = [...draft.images]
      for (const file of Array.from(files)) {
        if (images.length >= 100) throw new Error('图集最多100张')
        images.push((await uploadMedia(file, { folder: '/logs' })).url)
        // 逐张保留成功结果，后续文件失败或抽屉关闭也不丢失已上传地址。
        current.current.draft = { ...current.current.draft, images: [...images] }
        update('images', [...images])
        keepLocal()
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  if (!ready) return <p role="status">{message || '正在读取日志…'}</p>
  return (
    <form
      ref={form}
      onBlurCapture={(event) => {
        const element = event.target as HTMLElement
        const field =
          element.getAttribute('name') ??
          element.closest('[data-log-field]')?.getAttribute('data-log-field')
        if (!field || !(field in LogCreateSchema.shape)) return
        const result = LogCreateSchema.shape[field as keyof typeof LogCreateSchema.shape].safeParse(
          payload(current.current.draft)[field as keyof Draft],
        )
        setFieldErrors((previous) => [
          ...previous.filter((error) => error.path !== field),
          ...(!result.success
            ? result.error.issues.map((issue) => ({ path: field, message: issue.message }))
            : []),
        ])
      }}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {recovery && writable && (
        <aside className="rounded-lg border p-3">
          <p>发现尚未保存的本地日志稿。</p>
          <button
            type="button"
            className="text-brand mt-2"
            onClick={() => {
              setDraft(recovery.draft)
              setRevision(recovery.revision)
              setRecovery(null)
              setMessage('已恢复本地稿，保留原修订版本')
            }}
          >
            恢复本地日志草稿
          </button>
        </aside>
      )}
      <fieldset disabled={!writable || busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            日期
            <input
              type="date"
              name="logDate"
              className={control}
              value={draft.logDate}
              required
              onChange={(event) => update('logDate', event.target.value)}
            />
          </label>
          <label className="block text-sm">
            类型
            <select
              className={control}
              value={draft.type}
              name="type"
              onChange={(event) => update('type', event.target.value)}
            >
              {Object.entries(LOG_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          标题
          <input
            className={control}
            value={draft.title}
            name="title"
            required
            maxLength={200}
            onChange={(event) => update('title', event.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            心情
            <select
              aria-label="心情"
              className={control}
              value={draft.mood}
              name="mood"
              onChange={(event) => update('mood', event.target.value)}
            >
              <option value="">不设置</option>
              {Object.entries(MOODS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            天气
            <select
              aria-label="天气"
              className={control}
              value={draft.weather}
              name="weather"
              onChange={(event) => update('weather', event.target.value)}
            >
              <option value="">不设置</option>
              {Object.entries(WEATHER).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {writable && !busy ? (
          <div data-log-field="content">
            <MarkdownEditor value={draft.content} onChange={(value) => update('content', value)} />
          </div>
        ) : writable ? (
          <label className="block text-sm">
            正文
            <textarea
              aria-label="正文"
              className={control}
              rows={12}
              value={draft.content}
              readOnly
            />
          </label>
        ) : null}
        <label className="block text-sm">
          地点
          <input
            className={control}
            value={draft.location}
            name="location"
            maxLength={100}
            onChange={(event) => update('location', event.target.value)}
          />
        </label>
        <details open={!quick}>
          <summary className="cursor-pointer text-sm font-semibold">发布与更多信息</summary>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              摘要
              <textarea
                className={control}
                rows={3}
                value={draft.summary}
                name="summary"
                maxLength={500}
                onChange={(event) => update('summary', event.target.value)}
              />
            </label>
            <label className="block text-sm">
              状态
              <select
                aria-label="状态"
                className={control}
                value={draft.status}
                name="status"
                onChange={(event) => update('status', event.target.value)}
              >
                <option value="PUBLISHED">已发布</option>
                <option value="DRAFT">草稿</option>
                <option value="ARCHIVED">归档</option>
              </select>
            </label>
            <label className="block text-sm">
              发布时间（北京时间）
              <input
                type="datetime-local"
                name="publishedAt"
                className={control}
                value={
                  draft.publishedAt
                    ? new Date(Date.parse(draft.publishedAt) + 8 * 3600000)
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
                onChange={(event) =>
                  update(
                    'publishedAt',
                    event.target.value ? new Date(event.target.value + '+08:00').toISOString() : '',
                  )
                }
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.isPinned}
                onChange={(event) => update('isPinned', event.target.checked)}
              />
              置顶
            </label>
            <label className="block text-sm">
              封面地址
              <input
                className={control}
                value={draft.coverImage}
                name="coverImage"
                onChange={(event) => update('coverImage', event.target.value)}
              />
            </label>
            <fieldset
              data-log-field="tagIds"
              tabIndex={-1}
              aria-invalid={fieldErrors.some((error) => error.path.split('.')[0] === 'tagIds')}
              className="aria-invalid:border-destructive rounded-lg border p-3"
            >
              <legend>标签</legend>
              <div className="flex flex-wrap gap-3">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.tagIds.includes(tag.id)}
                      disabled={draft.tagIds.length >= 10 && !draft.tagIds.includes(tag.id)}
                      onChange={(event) =>
                        update(
                          'tagIds',
                          event.target.checked
                            ? [...draft.tagIds, tag.id]
                            : draft.tagIds.filter((id) => id !== tag.id),
                        )
                      }
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </details>
        <fieldset
          data-log-field="images"
          tabIndex={-1}
          aria-invalid={fieldErrors.some((error) => error.path.split('.')[0] === 'images')}
          className="aria-invalid:border-destructive space-y-3 rounded-lg border p-3"
        >
          <legend className="sr-only">图集</legend>
          <h2 className="text-sm font-semibold">图集（拖动或用按钮排序）</h2>
          {draft.images.map((url, index) => (
            <div
              key={url + index}
              draggable={writable}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const from = Number(event.dataTransfer.getData('text/plain'))
                if (Number.isInteger(from) && from >= 0 && from < draft.images.length) {
                  const next = [...draft.images]
                  next.splice(index, 0, next.splice(from, 1)[0])
                  update('images', next)
                }
              }}
              className="flex flex-wrap items-center gap-3 rounded border p-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{url}</span>
              {writable && (
                <>
                  <button
                    type="button"
                    aria-label={'图集' + (index + 1) + '上移'}
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...draft.images]
                      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                      update('images', next)
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        'images',
                        draft.images.filter((_, i) => i !== index),
                      )
                    }
                  >
                    移除
                  </button>
                </>
              )}
            </div>
          ))}
          {writable && (
            <label className="text-sm">
              上传图集
              <input
                aria-label="上传图集"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                className="mt-2 block w-full"
                onChange={(event) => {
                  void upload(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          )}
        </fieldset>
      </fieldset>
      {!writable && (
        <label className="block text-sm">
          正文
          <textarea
            aria-label="正文"
            className={control}
            rows={12}
            value={draft.content}
            readOnly
          />
        </label>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {!!fieldErrors.length && (
        <ul role="alert" className="text-destructive space-y-1 text-sm">
          {fieldErrors.map((error, index) => (
            <li key={index}>
              {error.path}：{error.message}
            </li>
          ))}
        </ul>
      )}
      {writable && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={busy || conflict}
            className="bg-primary text-primary-foreground rounded-lg px-5 py-2"
          >
            {busy ? '正在保存…' : '保存日志'}
          </button>
          {conflict && (
            <button
              type="button"
              disabled={busy}
              className="text-brand"
              onClick={() => void save(true)}
            >
              另存为新日志草稿
            </button>
          )}
        </div>
      )}
      {currentId && !quick && (
        <button
          type="button"
          disabled={busy}
          className="text-brand text-sm"
          onClick={async () => {
            try {
              const { data } = await api<{ url: string }>(
                '/api/v1/admin/logs/' + currentId + '/preview-token',
                { method: 'POST' },
              )
              window.open(data.url, '_blank', 'noopener,noreferrer')
            } catch (error) {
              setMessage((error as Error).message)
            }
          }}
        >
          预览已保存日志 ↗
        </button>
      )}
      {currentId && !quick && (
        <Link className="text-brand text-sm" href={'/admin/logs/' + currentId}>
          当前日志编辑地址
        </Link>
      )}
    </form>
  )
}
