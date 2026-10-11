'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pinyin } from 'pinyin-pro'
import { api, ClientError } from '@/lib/api/client'
import { uploadMedia } from '@/lib/api/upload'
import {
  emptyProjectDraft,
  projectDraftFromRecord,
  projectPayload,
  type ProjectDraft,
} from '@/lib/project-draft'
import { ProjectCreateSchema, ProjectUpdateSchema } from '@/lib/validators/project'
import { PROJECT_LINKS, PROJECT_TYPES } from '@/lib/project-display'
import { safeContentUrl } from '@/lib/markdown'
import { ProjectCard } from '@/components/site/project-card'
import { useAdminUser } from './shell'
import { CoverCrop } from './cover-crop'

const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p>加载编辑器…</p>,
})
const control =
  'bg-background aria-invalid:border-destructive mt-2 w-full rounded-lg border px-3 py-2'
type RecordItem = Record<string, unknown> & { id: string; revision: number }
type Issue = { path: string; message: string }
const slugify = (text: string) =>
  pinyin(text, { toneType: 'none', type: 'array' })
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200)
const localTime = (value: string, dateOnly = false) =>
  value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, dateOnly ? 10 : 16) : ''

/** 作品稿件完整保留服务端时间和版本，冲突停止自动保存而不覆盖新版本。 */
export function ProjectEditor({ id }: { id?: string }) {
  const user = useAdminUser(),
    writable = !!user?.permissions.includes('content:write'),
    router = useRouter()
  const [draft, setDraft] = useState(emptyProjectDraft),
    [currentId, setCurrentId] = useState(id),
    [revision, setRevision] = useState(1),
    [ready, setReady] = useState(!id)
  const [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState(''),
    [issues, setIssues] = useState<Issue[]>([])
  const [recovery, setRecovery] = useState<{ draft: ProjectDraft; revision: number } | null>(null),
    [tags, setTags] = useState<{ id: string; name: string }[]>([]),
    [historyTech, setHistoryTech] = useState<string[]>([]),
    [tech, setTech] = useState(''),
    [slugState, setSlugState] = useState('')
  const [linkWarnings, setLinkWarnings] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState(false)
  const [portfolioRoute, setPortfolioRoute] = useState('/portfolio')
  const current = useRef({ draft, currentId, revision, conflict }),
    locked = useRef(false),
    lastSaved = useRef(''),
    manualSlug = useRef(!!id),
    form = useRef<HTMLFormElement>(null)
  current.current = { draft, currentId, revision, conflict }
  const storageKey = `project-draft:${user?.id ?? 'pending'}:${currentId ?? 'new'}`
  const update = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === 'title' && !manualSlug.current ? { slug: slugify(String(value)) } : {}),
    }))
  const dirty = () => JSON.stringify(current.current.draft) !== lastSaved.current
  const keepLocal = () => {
    if (!ready || !writable || !dirty()) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: current.current.draft, revision: current.current.revision }),
      )
    } catch {
      setMessage('本地空间不足，请先保存或复制正文')
    }
  }
  const focusIssue = (path: string) => {
    const root = path.split('.')[0]
    if (!(root in emptyProjectDraft())) return
    const named = form.current?.elements.namedItem(path)
    const target =
      named instanceof HTMLElement
        ? named
        : form.current?.querySelector<HTMLElement>(
            '[data-project-field="' +
              root +
              '"] textarea, [data-project-field="' +
              root +
              '"] [contenteditable="true"], [data-project-field="' +
              root +
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
        if (id) {
          const { data } = await api<RecordItem>('/api/v1/admin/projects/' + id)
          if (!active) return
          const next = projectDraftFromRecord(data)
          setDraft(next)
          setRevision(data.revision)
          lastSaved.current = JSON.stringify(next)
        } else lastSaved.current = JSON.stringify(emptyProjectDraft())
        const local = localStorage.getItem(storageKey)
        if (local) {
          const parsed = JSON.parse(local)
          if (parsed.draft && Number.isInteger(parsed.revision)) setRecovery(parsed)
        }
        if (active) setReady(true)
      } catch (error) {
        if (active) setMessage((error as Error).message)
      }
    })()
    void api<{ tags: { id: string; name: string }[]; techStack: string[] }>(
      '/api/v1/admin/projects/options',
    )
      .then(({ data }) => {
        if (active) {
          setTags(data.tags)
          setHistoryTech(data.techStack)
        }
      })
      .catch((error) => {
        if (active) setMessage('选项读取失败：' + error.message)
      })
    void api<{ key: string; route: string }[]>('/api/v1/admin/modules')
      .then(({ data }) => {
        const portfolio = data.find((item) => item.key === 'portfolio')
        if (active && portfolio) setPortfolioRoute(portfolio.route)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [id, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!writable || !draft.slug) return
    let active = true
    const timer = setTimeout(() => {
      setSlugState('检查中…')
      void api<{ available: boolean }>(
        '/api/v1/admin/projects/slug-available?slug=' +
          encodeURIComponent(draft.slug) +
          (currentId ? '&excludeId=' + currentId : ''),
      )
        .then(({ data }) => {
          if (active) setSlugState(data.available ? '地址可用' : '地址已使用，请修改或添加后缀')
        })
        .catch((error) => {
          if (active) setSlugState(error.message)
        })
    }, 500)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [draft.slug, currentId, writable])
  const save = async (copy = false, automatic = false, status?: ProjectDraft['status']) => {
    if (!ready || !writable || locked.current || (current.current.conflict && !copy)) return
    const snapshot = { ...current.current.draft },
      target = copy ? undefined : current.current.currentId
    if (copy) {
      snapshot.status = 'DRAFT'
      snapshot.slug = snapshot.slug.slice(0, 150) + '-copy-' + Date.now().toString(36)
    } else if (status) snapshot.status = status
    const body = {
      ...projectPayload(snapshot),
      ...(target ? { revision: current.current.revision } : {}),
    }
    const result = (target ? ProjectUpdateSchema : ProjectCreateSchema).safeParse(body)
    if (!result.success) {
      if (!automatic) {
        const errors = result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
        setIssues(errors)
        setMessage('请修正作品字段后保存')
        focusIssue(errors[0].path)
      }
      return
    }
    locked.current = true
    setBusy(true)
    setIssues([])
    try {
      const { data } = await api<RecordItem>(
        '/api/v1/admin/projects' + (target ? '/' + target : ''),
        { method: target ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      )
      const next = projectDraftFromRecord(data)
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
      manualSlug.current = true
      try {
        localStorage.removeItem(storageKey)
      } catch {}
      setRecovery(null)
      setMessage(copy ? '已另存为新作品草稿' : '作品已保存')
    } catch (error) {
      if (
        error instanceof ClientError &&
        error.status === 409 &&
        !error.details?.some((issue) => issue.path === 'slug')
      ) {
        setConflict(true)
        setMessage('作品已有新版本，已保留本地稿；请重新加载比较或另存新草稿')
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
    const automatic = () => {
      if (current.current.draft.status === 'DRAFT' && dirty()) void save(false, true)
    }
    const timer = setInterval(automatic, 60000),
      editorUrl = location.href,
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
        void save(false, false, 'PUBLISHED')
      } else if (event.key === 'Escape' && !locked.current) {
        event.preventDefault()
        if (!dirty() || confirm('作品尚未保存，已保留本地稿。确定返回？')) {
          keepLocal()
          void (async () => {
            if (current.current.draft.status === 'DRAFT' && dirty()) await save(false, true)
            router.push('/admin/projects')
          })()
        }
      }
    }
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        new URL(link.href).pathname === location.pathname ||
        !dirty()
      )
        return
      event.preventDefault()
      event.stopPropagation()
      keepLocal()
      if (!confirm('作品尚未保存到服务器，已保留本地稿。确定离开？')) return
      void (async () => {
        if (current.current.draft.status === 'DRAFT') await save(false, true)
        if (new URL(link.href).origin === location.origin) router.push(link.href)
        else location.assign(link.href)
      })()
    }
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        keepLocal()
        automatic()
      }
    }
    const pop = (event: PopStateEvent) => {
      if (location.href === editorUrl || !dirty()) return
      keepLocal()
      if (!confirm('作品尚未保存，确定离开？')) {
        event.stopImmediatePropagation()
        history.pushState(editorState, '', editorUrl)
      } else automatic()
    }
    window.addEventListener('beforeunload', leave)
    window.addEventListener('keydown', keys)
    window.addEventListener('popstate', pop, true)
    document.addEventListener('click', click, true)
    document.addEventListener('visibilitychange', hide)
    return () => {
      clearInterval(timer)
      keepLocal()
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('keydown', keys)
      window.removeEventListener('popstate', pop, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [ready, writable, storageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files: FileList | null) => {
    if (!files || locked.current) return
    if (draft.gallery.length + files.length > 100) {
      setMessage('图集最多100张，请减少本次选择')
      return
    }
    locked.current = true
    setBusy(true)
    try {
      const gallery = [...current.current.draft.gallery]
      for (const file of Array.from(files)) {
        const media = await uploadMedia(file, { folder: '/projects' })
        gallery.push(media.url)
        const next = {
          ...current.current.draft,
          gallery: [...gallery],
          ...(!current.current.draft.coverImage && gallery.length === 1
            ? { coverImage: media.url }
            : {}),
        }
        current.current.draft = next
        setDraft(next)
        keepLocal()
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const checkLink = async (key: keyof ProjectDraft['links']) => {
    const value = current.current.draft.links[key]
    if (!value) return
    if (!safeContentUrl(value)) {
      setLinkWarnings((previous) => ({ ...previous, [key]: '地址不安全，请修改' }))
      return
    }
    try {
      const result = await fetch(value, {
        method: 'HEAD',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      })
      if (current.current.draft.links[key] !== value) return
      setLinkWarnings((previous) => ({
        ...previous,
        [key]: result.ok
          ? '链接可访问'
          : '无法确认可达性（HTTP ' + result.status + '），保存不受影响',
      }))
    } catch {
      if (current.current.draft.links[key] !== value) return
      setLinkWarnings((previous) => ({
        ...previous,
        [key]: '无法确认：跨域限制或网络失败，保存不受影响',
      }))
    }
  }
  const uploadCover = async (file: File) => {
    if (locked.current) throw new Error('请等待当前上传完成')
    locked.current = true
    setBusy(true)
    try {
      const media = await uploadMedia(file, { folder: '/projects' })
      const next = { ...current.current.draft, coverImage: media.url }
      current.current.draft = next
      setDraft(next)
      keepLocal()
      setMessage('裁切封面已上传，请保存作品')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const input = (key: 'title' | 'slug' | 'subtitle' | 'role' | 'coverImage', label: string) => (
    <label className="block text-sm">
      {label}
      <input
        name={key}
        aria-label={label}
        className={control}
        value={draft[key]}
        onChange={(event) => {
          if (key === 'slug') manualSlug.current = true
          update(key, event.target.value)
        }}
      />
    </label>
  )
  if (!ready) return <p role="status">{message || '正在读取作品…'}</p>
  const card = {
    ...projectPayload(draft),
    id: currentId ?? 'preview',
    links: projectPayload(draft).links,
  }
  return (
    <form
      ref={form}
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      onBlurCapture={(event) => {
        const target = event.target as HTMLElement,
          field =
            target.getAttribute('name') ??
            target.closest('[data-project-field]')?.getAttribute('data-project-field')
        if (!field) return
        const result = ProjectCreateSchema.safeParse(projectPayload(current.current.draft))
        const errors = result.success
          ? []
          : result.error.issues
              .filter((issue) => issue.path.join('.') === field || issue.path[0] === field)
              .map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        setIssues((previous) => [
          ...previous.filter((issue) => issue.path !== field && issue.path.split('.')[0] !== field),
          ...errors,
        ])
      }}
    >
      <Link className="text-brand text-sm" href="/admin/projects">
        ← 作品管理
      </Link>
      {recovery && writable && (
        <aside className="rounded-lg border p-3 text-sm">
          发现本地作品稿。
          <button
            type="button"
            className="text-brand ml-3"
            disabled={busy}
            onClick={() => {
              if (locked.current) return
              setDraft(recovery.draft)
              setRevision(recovery.revision)
              manualSlug.current = true
              setRecovery(null)
              setMessage('已恢复本地稿，保留原版本')
            }}
          >
            恢复作品草稿
          </button>
        </aside>
      )}
      <fieldset disabled={!writable || busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {input('title', '作品标题')}
          {input('slug', '作品地址 slug')}
        </div>
        <p className="text-muted-foreground text-xs">
          {slugState || '标题自动生成地址，手动修改后停止自动覆盖'}
        </p>
        {input('subtitle', '一句话亮点')}
        <CoverCrop disabled={!writable || busy} onUpload={uploadCover} />
        <label className="block text-sm">
          简介：解决了什么问题？
          <textarea
            name="description"
            aria-label="作品简介"
            className={control}
            rows={4}
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            作品类型
            <select
              name="type"
              aria-label="作品类型"
              className={control}
              value={draft.type}
              onChange={(event) => update('type', event.target.value as ProjectDraft['type'])}
            >
              {Object.entries(PROJECT_TYPES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.icon} {value.label}
                </option>
              ))}
            </select>
          </label>
          {input('role', '担任角色')}
        </div>
        <label className="block text-sm">
          成果亮点（每行一条）
          <textarea
            name="highlights"
            aria-label="成果亮点"
            className={control}
            rows={4}
            value={draft.highlights}
            placeholder="服务12条业务线，复用率78%"
            onChange={(event) => update('highlights', event.target.value)}
          />
        </label>
        <label className="block text-sm">
          技术栈（每行一项）
          <textarea
            name="techStack"
            aria-label="技术栈"
            className={control}
            rows={3}
            value={draft.techStack}
            onChange={(event) => update('techStack', event.target.value)}
          />
        </label>
        <label className="block text-sm">
          从历史技术栈补全
          <input
            aria-label="技术栈补全"
            list="project-tech-history"
            className={control}
            value={tech}
            onChange={(event) => setTech(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (tech.trim())
                  update('techStack', [draft.techStack, tech.trim()].filter(Boolean).join('\n'))
                setTech('')
              }
            }}
          />
        </label>
        <datalist id="project-tech-history">
          {historyTech.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <fieldset
          className="space-y-3 rounded-lg border p-4"
          data-project-field="links"
          tabIndex={-1}
        >
          <legend>外链（均可选）</legend>
          {Object.entries(PROJECT_LINKS).map(([key, label]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                name={'links.' + key}
                aria-label={label + '地址'}
                className={control}
                value={draft.links[key as keyof typeof PROJECT_LINKS]}
                onChange={(event) => update('links', { ...draft.links, [key]: event.target.value })}
                onBlur={() => void checkLink(key as keyof typeof PROJECT_LINKS)}
              />
              {linkWarnings[key] && (
                <span className="text-muted-foreground mt-2 block text-xs">
                  {linkWarnings[key]}
                </span>
              )}
            </label>
          ))}
          <button
            type="button"
            className="text-brand text-sm"
            onClick={() => {
              for (const key of Object.keys(PROJECT_LINKS) as (keyof typeof PROJECT_LINKS)[])
                void checkLink(key)
            }}
          >
            检查所有外链
          </button>
        </fieldset>
        {input('coverImage', '封面地址')}
        <fieldset
          data-project-field="gallery"
          tabIndex={-1}
          aria-invalid={issues.some((issue) => issue.path.split('.')[0] === 'gallery')}
          className="aria-invalid:border-destructive space-y-3 rounded-lg border p-4"
        >
          <legend>图集</legend>
          {draft.gallery.map((url, index) => (
            <div
              key={url + index}
              draggable={writable && !busy}
              onDragStart={(event) => {
                if (locked.current) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.setData('text/plain', String(index))
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (locked.current) return
                const from = Number(event.dataTransfer.getData('text/plain'))
                if (Number.isInteger(from) && from >= 0 && from < draft.gallery.length) {
                  const next = [...draft.gallery]
                  next.splice(index, 0, next.splice(from, 1)[0])
                  update('gallery', next)
                }
              }}
              className="flex flex-wrap items-center gap-3 rounded border p-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{url}</span>
              <button
                type="button"
                disabled={index === 0}
                aria-label={'作品图集' + (index + 1) + '上移'}
                onClick={() => {
                  const next = [...draft.gallery]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  update('gallery', next)
                }}
              >
                ↑
              </button>
              <button type="button" onClick={() => update('coverImage', url)}>
                设为封面
              </button>
              <button
                type="button"
                onClick={() =>
                  update(
                    'gallery',
                    draft.gallery.filter((_, i) => i !== index),
                  )
                }
              >
                移除
              </button>
            </div>
          ))}
          <label className="block text-sm">
            上传作品图集
            <input
              aria-label="上传作品图集"
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
        </fieldset>
        {writable && !busy && (
          <div data-project-field="content">
            <p className="mb-3 text-sm">详情正文（可选，无长文时只显示作品信息与外链）</p>
            <MarkdownEditor value={draft.content} onChange={(value) => update('content', value)} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {(['startDate', 'endDate'] as const).map((key) => (
            <label key={key} className="block text-sm">
              {key === 'startDate' ? '开始日期' : '结束日期'}
              <input
                name={key}
                aria-label={key === 'startDate' ? '开始日期' : '结束日期'}
                type="date"
                className={control}
                value={localTime(draft[key], true)}
                onChange={(event) =>
                  update(
                    key,
                    event.target.value
                      ? new Date(event.target.value + 'T00:00:00+08:00').toISOString()
                      : '',
                  )
                }
              />
            </label>
          ))}
        </div>
        <details open>
          <summary className="text-sm font-semibold">发布、首页与标签</summary>
          <div className="mt-4 space-y-4">
            <label className="block text-sm">
              状态
              <select
                name="status"
                aria-label="作品状态"
                className={control}
                value={draft.status}
                onChange={(event) => update('status', event.target.value as ProjectDraft['status'])}
              >
                <option value="PUBLISHED">已发布</option>
                <option value="DRAFT">草稿</option>
                <option value="ARCHIVED">归档</option>
              </select>
            </label>
            <label className="block text-sm">
              发布时间（北京时间）
              <input
                name="publishedAt"
                aria-label="作品发布时间"
                type="datetime-local"
                className={control}
                value={localTime(draft.publishedAt)}
                onChange={(event) =>
                  update(
                    'publishedAt',
                    event.target.value ? new Date(event.target.value + '+08:00').toISOString() : '',
                  )
                }
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                name="featured"
                type="checkbox"
                checked={draft.featured}
                onChange={(event) => update('featured', event.target.checked)}
              />
              首页精选
            </label>
            <label className="block text-sm">
              排序
              <input
                name="order"
                aria-label="作品顺序"
                type="number"
                min={0}
                max={1000000}
                className={control}
                value={draft.order}
                onChange={(event) => update('order', Number(event.target.value))}
              />
            </label>
            <fieldset
              data-project-field="tagIds"
              tabIndex={-1}
              aria-invalid={issues.some((issue) => issue.path.split('.')[0] === 'tagIds')}
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
      </fieldset>
      {(!writable || busy) && (
        <label className="block text-sm">
          只读正文
          <textarea
            aria-label="只读作品正文"
            readOnly
            className={control}
            rows={10}
            value={draft.content}
          />
        </label>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {!!issues.length && (
        <ul role="alert" className="text-destructive space-y-1 text-sm">
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.path}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {writable && (
          <>
            <button
              type="submit"
              disabled={busy || conflict}
              className="bg-primary text-primary-foreground rounded-lg px-5 py-2"
            >
              {busy ? '正在保存…' : '保存作品'}
            </button>
            <button
              type="button"
              disabled={busy || conflict}
              className="rounded-lg border px-4 py-2"
              onClick={() => void save(false, false, 'DRAFT')}
            >
              保存草稿
            </button>
            <button
              type="button"
              disabled={busy}
              className="text-brand"
              onClick={() => setPreview(!preview)}
            >
              预览当前卡片
            </button>
          </>
        )}
        {currentId && (
          <button
            type="button"
            disabled={busy}
            className="text-brand"
            onClick={async () => {
              try {
                const { data } = await api<{ url: string }>(
                  '/api/v1/admin/projects/' + currentId + '/preview-token',
                  { method: 'POST' },
                )
                window.open(data.url, '_blank', 'noopener,noreferrer')
              } catch (error) {
                setMessage((error as Error).message)
              }
            }}
          >
            预览已保存作品 ↗
          </button>
        )}
      </div>
      {conflict && (
        <aside role="alert" className="rounded-lg border border-amber-500 p-4 text-sm">
          版本冲突，自动保存已停止，本地稿保留。
          <button type="button" className="text-brand ml-3" onClick={() => location.reload()}>
            重新加载比较
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-brand ml-3"
            onClick={() => void save(true)}
          >
            另存为新作品草稿
          </button>
        </aside>
      )}
      {preview && (
        <section aria-label="当前作品卡片预览" className="max-w-md">
          <ProjectCard item={card} route={portfolioRoute} />
        </section>
      )}
      {currentId && (
        <Link className="text-brand block text-sm" href={'/admin/projects/' + currentId}>
          当前作品编辑地址
        </Link>
      )}
    </form>
  )
}
