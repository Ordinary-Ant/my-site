'use client'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ClientError } from '@/lib/api/client'
import { uploadMedia } from '@/lib/api/upload'
import { TimelineCreateSchema, TimelineUpdateSchema } from '@/lib/validators/timeline'
import { TIMELINE_TYPES, type DatePrecision } from '@/lib/timeline-display'
import {
  emptyTimelineDraft,
  timelineDraftFromRecord,
  timelinePayload,
  changeTimelinePrecision,
  type TimelineDraft,
} from '@/lib/timeline-draft'
import { useAdminUser } from './shell'

const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p>加载编辑器…</p>,
})
const control =
  'bg-background aria-invalid:border-destructive mt-2 w-full rounded-lg border px-3 py-2'
type RecordItem = Record<string, unknown> & { id: string; revision: number }
type Issue = { path: string; message: string }
/** 时间线没有发布草稿状态，未确认的输入仅保留本地；手动保存执行服务端版本锁。 */
export function TimelineEditor({ id, copyId }: { id?: string; copyId?: string }) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('content:write'),
    router = useRouter()
  const [draft, setDraft] = useState(emptyTimelineDraft),
    [currentId, setCurrentId] = useState(id),
    [revision, setRevision] = useState(1),
    [ready, setReady] = useState(!id && !copyId)
  const [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState(''),
    [issues, setIssues] = useState<Issue[]>([])
  const [recovery, setRecovery] = useState<{ draft: TimelineDraft; revision: number } | null>(null),
    [otherCurrent, setOtherCurrent] = useState(0)
  const current = useRef({ draft, currentId, revision, conflict }),
    locked = useRef(false),
    lastSaved = useRef(''),
    form = useRef<HTMLFormElement>(null)
  current.current = { draft, currentId, revision, conflict }
  const storageKey = `timeline-draft:${user?.id ?? 'pending'}:${currentId ?? (copyId ? 'copy-' + copyId : 'new')}`
  const update = <K extends keyof TimelineDraft>(key: K, value: TimelineDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))
  const dirty = () => JSON.stringify(current.current.draft) !== lastSaved.current
  const keepLocal = () => {
    if (!ready || !writable || !dirty()) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: current.current.draft, revision: current.current.revision }),
      )
    } catch {
      setMessage('本地空间不足，请先保存或复制内容')
    }
  }
  const focusIssue = (path: string) => {
    const root = path.split('.')[0]
    if (!(root in emptyTimelineDraft())) return
    const named = form.current?.elements.namedItem(root),
      target =
        named instanceof HTMLElement
          ? named
          : form.current?.querySelector<HTMLElement>(
              '[data-timeline-field="' +
                root +
                '"] textarea, [data-timeline-field="' +
                root +
                '"] [contenteditable="true"]',
            )
    target?.scrollIntoView({ block: 'center' })
    target?.focus()
  }
  useEffect(() => {
    for (const element of Array.from(form.current?.elements ?? []))
      if (element instanceof HTMLElement && element.getAttribute('name'))
        element.setAttribute(
          'aria-invalid',
          String(issues.some((issue) => issue.path === element.getAttribute('name'))),
        )
  }, [issues])
  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      try {
        let next = emptyTimelineDraft()
        if (id || copyId) {
          const { data } = await api<RecordItem>('/api/v1/admin/timeline/' + (id ?? copyId))
          if (!active) return
          next = timelineDraftFromRecord(data)
          if (id) setRevision(data.revision)
          else {
            next.title = next.title.slice(0, 196) + '（副本）'
            next.visible = false
            next.showOnAbout = false
            setMessage('已复制经历，保存前检查起止与可见性')
          }
        }
        setDraft(next)
        lastSaved.current = JSON.stringify(next)
        try {
          const local = localStorage.getItem(storageKey)
          if (local) {
            const parsed = JSON.parse(local),
              defaults = emptyTimelineDraft()
            if (
              parsed.draft &&
              Number.isInteger(parsed.revision) &&
              Object.entries(defaults).every(
                ([key, value]) => typeof parsed.draft[key] === typeof value,
              )
            )
              setRecovery(parsed)
            else setMessage('本地稿格式无效，已加载服务器版本')
          }
        } catch {
          setMessage('本地稿无法读取，已加载服务器版本')
        }
        if (active) setReady(true)
      } catch (error) {
        if (active) setMessage((error as Error).message)
      }
    })()
    void api<{ isCurrent: boolean; id: string }[]>('/api/v1/admin/timeline?pageSize=100')
      .then(({ data }) => {
        if (active) setOtherCurrent(data.filter((item) => item.isCurrent && item.id !== id).length)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [id, copyId, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (copy = false, makeVisible = false) => {
    if (!ready || !writable || locked.current || (current.current.conflict && !copy)) return
    const snapshot = { ...current.current.draft },
      target = copy ? undefined : current.current.currentId
    if (copy) {
      snapshot.title = snapshot.title.slice(0, 196) + '（副本）'
      snapshot.visible = false
      snapshot.showOnAbout = false
    } else if (makeVisible) snapshot.visible = true
    const body = {
        ...timelinePayload(snapshot),
        ...(target ? { revision: current.current.revision } : {}),
      },
      result = (target ? TimelineUpdateSchema : TimelineCreateSchema).safeParse(body)
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
      setIssues(errors)
      setMessage('请修正经历字段后保存')
      focusIssue(errors[0].path)
      return
    }
    locked.current = true
    setBusy(true)
    setIssues([])
    try {
      const { data } = await api<RecordItem>(
        '/api/v1/admin/timeline' + (target ? '/' + target : ''),
        { method: target ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      )
      const next = timelineDraftFromRecord(data)
      current.current = {
        draft: next,
        currentId: data.id,
        revision: data.revision,
        conflict: false,
      }
      lastSaved.current = JSON.stringify(next)
      setDraft(next)
      setCurrentId(data.id)
      setRevision(data.revision)
      setConflict(false)
      setRecovery(null)
      try {
        localStorage.removeItem(storageKey)
      } catch {}
      setMessage(copy ? '已另存为新经历（两个公开开关均关闭）' : '经历已保存')
    } catch (error) {
      if (error instanceof ClientError && error.status === 409) {
        setConflict(true)
        setMessage('经历已有新版本，本地输入保留')
      } else {
        setMessage((error as Error).message)
        if (error instanceof ClientError && error.details) {
          setIssues(error.details)
          requestAnimationFrame(() => focusIssue(error.details![0]?.path ?? ''))
        }
      }
      keepLocal()
    } finally {
      locked.current = false
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
    const editorUrl = location.href,
      editorState = history.state
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        keepLocal()
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const keys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void save(false, true)
      } else if (event.key === 'Escape' && !locked.current) {
        event.preventDefault()
        if (!dirty() || confirm('经历尚未保存，已保留本地稿。确定返回？')) {
          keepLocal()
          router.push('/admin/timeline')
        }
      }
    }
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]')
      if (!link || link.getAttribute('target') === '_blank' || !dirty()) return
      const url = new URL(link.getAttribute('href')!, location.href)
      if (url.href === location.href || url.pathname === location.pathname) return
      keepLocal()
      if (!confirm('经历尚未保存，确定离开？')) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') keepLocal()
    }
    const pop = (event: PopStateEvent) => {
      if (location.href === editorUrl || !dirty()) return
      keepLocal()
      if (!confirm('经历尚未保存，确定离开？')) {
        event.stopImmediatePropagation()
        history.pushState(editorState, '', editorUrl)
      }
    }
    window.addEventListener('beforeunload', leave)
    window.addEventListener('keydown', keys)
    window.addEventListener('popstate', pop, true)
    document.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', hide)
    return () => {
      keepLocal()
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('popstate', pop, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [ready, writable, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const uploadLogo = async (file: File | undefined) => {
    if (!file || locked.current) return
    locked.current = true
    setBusy(true)
    try {
      const media = await uploadMedia(file, { folder: '/timeline' })
      const next = { ...current.current.draft, logo: media.url }
      current.current.draft = next
      setDraft(next)
      keepLocal()
      setMessage('机构标志已上传，请保存经历')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const input = (
    key: 'title' | 'subtitle' | 'organization' | 'location' | 'logo',
    label: string,
  ) => (
    <label className="block text-sm">
      {label}
      <input
        name={key}
        aria-label={label}
        className={control}
        value={draft[key]}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  )
  const dateField = (key: 'startDate' | 'endDate', label: string) => {
    const precision = key === 'startDate' ? 'startPrecision' : 'endPrecision'
    return (
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend>{label}</legend>
        <label className="block text-sm">
          日期精度
          <select
            name={precision}
            aria-label={label + '精度'}
            className={control}
            value={draft[precision]}
            onChange={(event) => {
              const value = event.target.value as DatePrecision
              setDraft((previous) => ({
                ...previous,
                [precision]: value,
                [key]: changeTimelinePrecision(previous[key], value),
              }))
            }}
          >
            <option value="YEAR">年</option>
            <option value="MONTH">月</option>
            <option value="DAY">日</option>
          </select>
        </label>
        <input
          name={key}
          aria-label={label}
          className={control}
          type={
            draft[precision] === 'YEAR' ? 'number' : draft[precision] === 'MONTH' ? 'month' : 'date'
          }
          min={draft[precision] === 'YEAR' ? 1 : undefined}
          max={draft[precision] === 'YEAR' ? 9998 : undefined}
          disabled={key === 'endDate' && draft.isCurrent}
          value={draft[key]}
          onChange={(event) => update(key, event.target.value)}
        />
      </fieldset>
    )
  }
  if (!ready) return <p role="status">{message || '正在读取经历…'}</p>
  return (
    <form
      ref={form}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onBlurCapture={(event) => {
        const field = (event.target as HTMLElement).getAttribute('name')
        if (!field) return
        const result = TimelineCreateSchema.safeParse(timelinePayload(current.current.draft)),
          next = result.success
            ? []
            : result.error.issues
                .filter((issue) => issue.path[0] === field)
                .map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        setIssues((previous) => [
          ...previous.filter((issue) => issue.path.split('.')[0] !== field),
          ...next,
        ])
      }}
    >
      <Link href="/admin/timeline" className="text-brand text-sm">
        ← 时间戳管理
      </Link>
      {recovery && writable && (
        <aside className="rounded-lg border p-3 text-sm">
          发现本地经历稿。
          <button
            type="button"
            disabled={busy}
            className="text-brand ml-3"
            onClick={() => {
              if (locked.current) return
              setDraft(recovery.draft)
              setRevision(recovery.revision)
              setRecovery(null)
              setMessage('已恢复本地稿，保留原版本')
            }}
          >
            恢复经历草稿
          </button>
        </aside>
      )}
      <fieldset disabled={!writable || busy} className="space-y-5">
        {input('title', '经历标题')}
        {input('subtitle', '副标题')}
        <label className="block text-sm">
          经历类型
          <select
            name="type"
            aria-label="经历类型"
            className={control}
            value={draft.type}
            onChange={(event) => update('type', event.target.value as TimelineDraft['type'])}
          >
            {Object.entries(TIMELINE_TYPES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.icon} {value.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {input('organization', '公司或机构')}
          {input('location', '城市')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {dateField('startDate', '开始日期')}
          {dateField('endDate', '结束日期')}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            name="isCurrent"
            type="checkbox"
            checked={draft.isCurrent}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                isCurrent: event.target.checked,
                ...(event.target.checked ? { endDate: '' } : {}),
              }))
            }
          />
          至今（清空结束日期）
        </label>
        {draft.isCurrent && otherCurrent > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            已有其它当前经历。允许多条，但通常只保留一条，请核对。
          </p>
        )}
        {input('logo', '机构标志地址')}
        <label className="block text-sm">
          上传机构标志
          <input
            aria-label="上传机构标志"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="mt-2 block w-full"
            onChange={(event) => {
              void uploadLogo(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        {(['highlights', 'tags'] as const).map((key) => (
          <label className="block text-sm" key={key}>
            {key === 'highlights' ? '关键成果（每行一条）' : '关键词（每行一项）'}
            <textarea
              name={key}
              aria-label={key === 'highlights' ? '关键成果' : '经历关键词'}
              className={control}
              rows={4}
              value={draft[key]}
              onChange={(event) => update(key, event.target.value)}
            />
          </label>
        ))}
        {writable && !busy && (
          <div data-timeline-field="description">
            <p className="mb-3 text-sm">经历详述（选择与结果，可选）</p>
            <MarkdownEditor
              value={draft.description}
              onChange={(value) => update('description', value)}
            />
          </div>
        )}
        <label className="flex gap-2 text-sm">
          <input
            name="visible"
            type="checkbox"
            checked={draft.visible}
            onChange={(event) => update('visible', event.target.checked)}
          />
          在时间线显示
        </label>
        <label className="flex gap-2 text-sm">
          <input
            name="showOnAbout"
            type="checkbox"
            checked={draft.showOnAbout}
            onChange={(event) => update('showOnAbout', event.target.checked)}
          />
          在关于我工作经历显示（仅工作类型）
        </label>
        <label className="block text-sm">
          同日期顺序
          <input
            name="order"
            aria-label="同日期顺序"
            type="number"
            min={0}
            max={1000000}
            className={control}
            value={draft.order}
            onChange={(event) => update('order', Number(event.target.value))}
          />
        </label>
        <p className="text-muted-foreground text-xs">
          当前项优先，其后按起始日期和同日期顺序排列；跨日期拖拽不会覆盖日期排序。
        </p>
      </fieldset>
      {(!writable || busy) && (
        <label className="block text-sm">
          只读经历正文
          <textarea
            aria-label="只读经历正文"
            className={control}
            rows={10}
            readOnly
            value={draft.description}
          />
        </label>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {!!issues.length && (
        <ul role="alert" className="text-destructive text-sm">
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.path}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      {writable && (
        <button
          type="submit"
          disabled={busy || conflict}
          className="bg-primary text-primary-foreground rounded-lg px-5 py-2 text-sm"
        >
          {busy ? '正在保存…' : '保存经历'}
        </button>
      )}
      {conflict && (
        <aside role="alert" className="rounded-lg border border-amber-500 p-4 text-sm">
          版本冲突，输入已保留。
          <button
            type="button"
            disabled={busy}
            className="text-brand ml-3"
            onClick={() => location.reload()}
          >
            重新加载比较
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-brand ml-3"
            onClick={() => void save(true)}
          >
            另存新经历
          </button>
        </aside>
      )}
      {currentId && (
        <Link href={'/admin/timeline/' + currentId} className="text-brand block text-sm">
          当前经历编辑地址
        </Link>
      )}
    </form>
  )
}
