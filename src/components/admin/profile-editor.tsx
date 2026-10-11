'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api, ClientError } from '@/lib/api/client'
import { uploadMedia } from '@/lib/api/upload'
import {
  profileDraft,
  profilePayload,
  profileLocalDraftSchema,
  type ProfileDraft,
  type ProfileCard,
} from '@/lib/profile-draft'
import { ProfileUpdateSchema } from '@/lib/validators/profile'
import { safeContentUrl } from '@/lib/markdown'
import { useAdminUser } from './shell'
import { ProfileArrayEditor } from './profile-array-editor'
import { ProfileIconPicker } from './profile-icons'
const MarkdownEditor = dynamic(() => import('./markdown-editor'), {
  ssr: false,
  loading: () => <p>加载编辑器…</p>,
})
const control =
  'mt-2 w-full rounded-lg border bg-background px-3 py-2 aria-invalid:border-destructive'
type Issue = { path: string; message: string }
/** 单例编辑只显式保存；本地草稿和修订冲突保护尚未确认的个人资料。 */
export function ProfileEditor() {
  const user = useAdminUser(),
    writable = !!user && user.role !== 'VIEWER'
  const [draft, setDraft] = useState(() => profileDraft()),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [issues, setIssues] = useState<Issue[]>([]),
    [recovery, setRecovery] = useState<ProfileDraft | null>(null),
    [conflict, setConflict] = useState(false),
    [experience, setExperience] = useState<{ id: string; title: string; showOnAbout: boolean }[]>(
      [],
    ),
    [aboutRoute, setAboutRoute] = useState('/about'),
    [undo, setUndo] = useState<ProfileDraft | null>(null),
    [checking, setChecking] = useState(false)
  const current = useRef(draft),
    saved = useRef(''),
    revision = useRef(0),
    locked = useRef(false),
    localKey = 'profile-draft:' + (user?.id ?? 'pending')
  current.current = draft
  const dirty = () => ready && JSON.stringify(current.current) !== saved.current
  const sync = (next: ProfileDraft) => {
    // 所有新快照（含上传和恢复）都结束旧撤销窗口，防止回退新资料。
    setUndo(null)
    current.current = next
    setDraft(next)
  }
  const keepLocal = () => {
    if (!writable || !dirty()) return
    try {
      localStorage.setItem(localKey, JSON.stringify(current.current))
    } catch {
      setMessage('本地草稿空间不足，请保留当前内容。')
    }
  }
  useEffect(() => {
    let active = true
    void Promise.all([
      api<Record<string, unknown> & { revision: number; experience: typeof experience }>(
        '/api/v1/admin/profile',
      ),
      api<{ key: string; route: string }[]>('/api/v1/modules'),
    ])
      .then(([result, modules]) => {
        if (!active) return
        const next = profileDraft(result.data)
        sync(next)
        saved.current = JSON.stringify(next)
        revision.current = result.data.revision
        setExperience(result.data.experience)
        setAboutRoute(modules.data.find((item) => item.key === 'about')?.route ?? '/about')
        setReady(true)
        if (writable) {
          try {
            const raw = localStorage.getItem(localKey)
            if (raw) {
              const stored = profileLocalDraftSchema.safeParse(JSON.parse(raw))
              if (!stored.success) throw new Error('本地稿结构损坏')
              const parsed = profileDraft(stored.data)
              if (JSON.stringify(parsed) !== saved.current) setRecovery(parsed)
            }
          } catch {
            setMessage('本地稿无法读取，已加载服务器资料。')
          }
        }
      })
      .catch((failure: Error) => active && setError(failure.message))
    return () => {
      active = false
    }
  }, [localKey, writable])
  useEffect(() => {
    if (!ready || !writable) return
    const timer = setTimeout(keepLocal, 3000)
    return () => clearTimeout(timer)
  }, [draft, ready, writable]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        keepLocal()
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') keepLocal()
    }
    const back = () => keepLocal()
    const click = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest?.('a[href]')
      if (anchor && dirty()) {
        if (!confirm('尚有未保存资料，离开并保留本地稿？')) event.preventDefault()
        else keepLocal()
      }
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('popstate', back)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('popstate', back)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('click', click, true)
    }
  }, [ready, writable]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    if (!writable || locked.current) return
    // 新编辑结束上一轮删除撤销，避免整份旧快照覆盖后续输入。
    setUndo(null)
    sync({ ...current.current, [key]: value })
    setIssues([])
  }
  const save = async () => {
    if (!ready || !writable || locked.current) return
    setError('')
    setMessage('')
    const payload = profilePayload(current.current, revision.current),
      parsed = ProfileUpdateSchema.safeParse(payload)
    if (!parsed.success) {
      const invalid = parsed.error.issues.map((item) => ({
        path: item.path.join('.'),
        message: item.message,
      }))
      setIssues(invalid)
      const field = document.querySelector<HTMLInputElement>('[name="' + invalid[0].path + '"]')
      const section = field?.closest('details')
      if (section) section.open = true
      field?.focus()
      return
    }
    locked.current = true
    setBusy(true)
    try {
      const result = await api<Record<string, unknown> & { revision: number }>(
        '/api/v1/admin/profile',
        { method: 'PATCH', body: JSON.stringify(parsed.data) },
      )
      const next = profileDraft(result.data)
      sync(next)
      saved.current = JSON.stringify(next)
      revision.current = result.data.revision
      setConflict(false)
      setRecovery(null)
      setUndo(null)
      try {
        localStorage.removeItem(localKey)
      } catch {}
      setMessage('资料已保存，刷新公开页面可查看。')
    } catch (failure) {
      keepLocal()
      if (failure instanceof ClientError && failure.status === 409) {
        setConflict(true)
        setError('版本冲突：当前资料已保留，请复制后刷新比较，避免覆盖他人更新。')
      } else setError((failure as Error).message)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [ready, writable]) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (file: File | undefined, key: 'avatar' | 'resumeUrl') => {
    if (!file || !writable || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const media = await uploadMedia(file, { folder: key === 'avatar' ? '/profile' : '/resumes' })
      sync({ ...current.current, [key]: media.url })
      keepLocal()
      setMessage('上传成功，保存资料后生效。')
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const remove = (key: 'advantages' | 'skills' | 'services' | 'socials', index: number) => {
    if (locked.current || !writable) return
    const snapshot = structuredClone(current.current)
    update(key, current.current[key].filter((_, i) => i !== index) as never)
    setUndo(snapshot)
    setMessage('已删除，可撤销。')
  }
  const field = (key: keyof ProfileDraft, label: string, type = 'text') => (
    <label className="block text-sm">
      {label}
      <input
        name={key}
        aria-label={label}
        type={type}
        value={String(draft[key] ?? '')}
        min={type === 'number' ? 0 : undefined}
        max={type === 'number' ? 100 : undefined}
        aria-invalid={issues.some((item) => item.path === key)}
        className={control}
        onChange={(event) => update(key, event.target.value as never)}
      />
    </label>
  )
  const card = (
    item: ProfileCard,
    index: number,
    change: (item: ProfileCard) => void,
    label: string,
  ) => (
    <div className="space-y-3">
      <label className="block text-sm">
        标题
        <input
          name={(label === '优势' ? 'advantages' : 'services') + '.' + index + '.title'}
          aria-label={label + '标题 ' + (index + 1)}
          className={control}
          value={item.title}
          onChange={(event) => change({ ...item, title: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        描述
        <textarea
          aria-label={label + '描述 ' + (index + 1)}
          className={control}
          value={item.description}
          onChange={(event) => change({ ...item, description: event.target.value })}
          placeholder="例如：搭建CI/CD，首屏耗时降低40%，避免空泛的自我评价。"
        />
      </label>
      <ProfileIconPicker
        value={item.icon}
        onChange={(icon) => change({ ...item, icon })}
        disabled={busy || !writable}
        label={label + '图标 ' + (index + 1)}
      />
    </div>
  )
  if (!ready) return <div>{error ? <p role="alert">{error}</p> : <p>加载个人资料…</p>}</div>
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">关于我资料</h1>
        <div className="flex gap-4">
          <Link href={aboutRoute} target="_blank" rel="noopener noreferrer">
            查看公开页 ↗
          </Link>
          {writable && !busy && (
            <button
              disabled={busy}
              type="button"
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2"
              onClick={() => void save()}
            >
              保存资料
            </button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="text-destructive mb-4 whitespace-pre-wrap">
          {error}
        </p>
      )}
      <p role="status" className="mb-4 text-sm">
        {message}
      </p>
      {issues.length > 0 && (
        <ul role="alert" className="text-destructive mb-4 text-sm">
          {issues.map((item, index) => (
            <li key={index}>
              {item.path}：{item.message}
            </li>
          ))}
        </ul>
      )}
      {recovery && (
        <div className="mb-4 rounded border p-4">
          有未保存的本地稿。
          <button
            type="button"
            disabled={busy}
            className="ml-3 underline"
            onClick={() => {
              if (locked.current) return
              sync(recovery)
              setRecovery(null)
            }}
          >
            恢复本地稿
          </button>
          <button
            type="button"
            disabled={busy}
            className="ml-3 underline"
            onClick={() => {
              if (locked.current) return
              localStorage.removeItem(localKey)
              setRecovery(null)
            }}
          >
            丢弃本地稿
          </button>
        </div>
      )}
      {undo && (
        <button
          type="button"
          disabled={busy}
          className="mb-4 underline"
          onClick={() => {
            if (locked.current) return
            sync(undo)
            setUndo(null)
            setMessage('已撤销删除。')
          }}
        >
          撤销上次删除
        </button>
      )}
      {conflict && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  JSON.stringify(profilePayload(current.current, revision.current), null, 2),
                )
                .then(
                  () => setMessage('当前资料已复制'),
                  () => setMessage('复制失败，请从下方选择当前资料。'),
                )
            }}
          >
            复制当前资料
          </button>
          <textarea
            aria-label="冲突资料副本"
            readOnly
            value={JSON.stringify(profilePayload(draft, revision.current), null, 2)}
            className={control}
          />
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={!writable || busy} className="space-y-5">
          <details open className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">基本信息</summary>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {field('name', '姓名')}
              {field('headline', '一句话定位')}
              {field('jobTitle', '职位')}
              {field('company', '公司')}
              {field('location', '城市')}
              {field('yearsOfExp', '工作年限', 'number')}
              {field('birthday', '生日', 'date')}
              {field('avatar', '头像地址')}
              <label className="text-sm">
                上传头像
                <input
                  aria-label="上传头像"
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full"
                  onChange={(event) => {
                    void upload(event.target.files?.[0], 'avatar')
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              生日仅用于后台资料，不在公开页面输出。
            </p>
          </details>
          <details open className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">自我介绍</summary>
            {writable && !busy && (
              <div className="mt-5">
                <MarkdownEditor value={draft.bio} onChange={(value) => update('bio', value)} />
              </div>
            )}
          </details>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">
              个人优势（{draft.advantages.length}项）
            </summary>
            <div className="mt-5">
              <ProfileArrayEditor
                items={draft.advantages}
                onChange={(items) => update('advantages', items)}
                empty={() => ({ title: '', description: '', icon: 'wrench' })}
                label="优势"
                disabled={busy || !writable}
                onDelete={(index) => remove('advantages', index)}
                render={(item, index, change) => card(item, index, change, '优势')}
              />
            </div>
          </details>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">
              技能矩阵（{draft.skills.length}组）
            </summary>
            <div className="mt-5">
              <ProfileArrayEditor
                items={draft.skills}
                onChange={(items) => update('skills', items)}
                empty={() => ({ category: '', items: [] })}
                label="技能组"
                disabled={busy || !writable}
                onDelete={(index) => remove('skills', index)}
                render={(group, index, change) => (
                  <div className="space-y-4">
                    <label className="block text-sm">
                      分组名称
                      <input
                        name={'skills.' + index + '.category'}
                        aria-label={'技能组名称 ' + (index + 1)}
                        className={control}
                        value={group.category}
                        onChange={(event) => change({ ...group, category: event.target.value })}
                      />
                    </label>
                    {group.items.map((item, i) => (
                      <div key={i} className="rounded border p-3">
                        <label className="block text-sm">
                          技能名称
                          <input
                            name={'skills.' + index + '.items.' + i + '.name'}
                            aria-label={'技能名称 ' + (index + 1) + '-' + (i + 1)}
                            className={control}
                            value={item.name}
                            onChange={(event) =>
                              change({
                                ...group,
                                items: group.items.map((value, j) =>
                                  i === j ? { ...value, name: event.target.value } : value,
                                ),
                              })
                            }
                          />
                        </label>
                        <label className="mt-3 block text-sm">
                          使用年限
                          <input
                            aria-label={'技能年限 ' + (index + 1) + '-' + (i + 1)}
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            className={control}
                            value={item.years}
                            onChange={(event) =>
                              change({
                                ...group,
                                items: group.items.map((value, j) =>
                                  i === j ? { ...value, years: Number(event.target.value) } : value,
                                ),
                              })
                            }
                          />
                        </label>
                        <div
                          role="group"
                          aria-label={'技能等级 ' + (index + 1) + '-' + (i + 1)}
                          className="mt-3 flex gap-2"
                        >
                          {[1, 2, 3, 4, 5].map((level) => (
                            <button
                              type="button"
                              key={level}
                              aria-pressed={item.level === level}
                              aria-label={'等级 ' + level + '星'}
                              onClick={() =>
                                change({
                                  ...group,
                                  items: group.items.map((value, j) =>
                                    i === j ? { ...value, level } : value,
                                  ),
                                })
                              }
                              className={
                                'rounded border p-2 ' +
                                (level <= item.level ? 'text-brand' : 'text-muted-foreground')
                              }
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="text-destructive mt-3 text-sm"
                          onClick={() => {
                            const snapshot = structuredClone(current.current)
                            change({ ...group, items: group.items.filter((_, j) => i !== j) })
                            setUndo(snapshot)
                          }}
                        >
                          删除技能 {item.name || i + 1}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={group.items.length >= 100}
                      className="rounded border px-3 py-2 text-sm"
                      onClick={() =>
                        change({
                          ...group,
                          items: [...group.items, { name: '', level: 3, years: 0 }],
                        })
                      }
                    >
                      添加技能
                    </button>
                  </div>
                )}
              />
            </div>
          </details>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">
              社交链接（{draft.socials.length}项）
            </summary>
            <div className="mt-5">
              <ProfileArrayEditor
                items={draft.socials}
                onChange={(items) => update('socials', items)}
                empty={() => ({ platform: '', label: '', url: '', icon: 'globe' })}
                label="社交"
                disabled={busy || !writable}
                onDelete={(index) => remove('socials', index)}
                render={(item, index, change) => (
                  <div className="space-y-3">
                    {(['platform', 'label', 'url'] as const).map((key) => (
                      <label key={key} className="block text-sm">
                        {{ platform: '平台', label: '显示名称', url: '链接' }[key]}
                        <input
                          name={'socials.' + index + '.' + key}
                          aria-label={
                            '社交' +
                            { platform: '平台', label: '名称', url: '链接' }[key] +
                            ' ' +
                            (index + 1)
                          }
                          className={control}
                          value={item[key]}
                          onChange={(event) => change({ ...item, [key]: event.target.value })}
                        />
                      </label>
                    ))}
                    <ProfileIconPicker
                      value={item.icon}
                      onChange={(icon) => change({ ...item, icon })}
                      disabled={busy || !writable}
                      label={'社交图标 ' + (index + 1)}
                    />
                  </div>
                )}
              />
            </div>
          </details>
          <details className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">
              我能提供（{draft.services.length}项）
            </summary>
            <div className="mt-5">
              <ProfileArrayEditor
                items={draft.services}
                onChange={(items) => update('services', items)}
                empty={() => ({ title: '', description: '', icon: 'handshake' })}
                label="服务"
                disabled={busy || !writable}
                onDelete={(index) => remove('services', index)}
                render={(item, index, change) => card(item, index, change, '服务')}
              />
            </div>
          </details>
          <details open className="rounded-xl border p-5">
            <summary className="cursor-pointer font-semibold">联系方式</summary>
            <label className="mt-5 flex items-center gap-3 text-sm">
              <input
                aria-label="公开联系方式"
                type="checkbox"
                checked={draft.contactVisible}
                onChange={(event) => update('contactVisible', event.target.checked)}
              />
              前台公开邮箱与电话
            </label>
            <p className="text-muted-foreground mt-3 text-sm">
              关闭后，全站公共出口隐藏邮箱、电话及mailto/tel链接；安全社交链接可保留。
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {field('email', '邮箱')}
              {field('phone', '电话')}
              {field('resumeUrl', '简历地址')}
              <label className="text-sm">
                上传PDF简历
                <input
                  aria-label="上传PDF简历"
                  type="file"
                  accept="application/pdf"
                  className="mt-2 block w-full"
                  onChange={(event) => {
                    void upload(event.target.files?.[0], 'resumeUrl')
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={checking || !safeContentUrl(draft.resumeUrl)}
              className="mt-4 rounded border px-3 py-2 text-sm"
              onClick={() => {
                const url = current.current.resumeUrl
                if (!safeContentUrl(url)) return
                const controller = new AbortController(),
                  timer = setTimeout(() => controller.abort(), 5000)
                setChecking(true)
                void fetch(url, { method: 'HEAD', credentials: 'omit', signal: controller.signal })
                  .then((response) => {
                    if (current.current.resumeUrl === url)
                      setMessage(response.ok ? '简历链接可访问' : '简历链接返回 ' + response.status)
                  })
                  .catch(() => {
                    if (current.current.resumeUrl === url)
                      setMessage('暂时无法测试链接，可能受跨域或网络限制；可自行打开核对。')
                  })
                  .finally(() => {
                    clearTimeout(timer)
                    setChecking(false)
                  })
              }}
            >
              测试简历链接
            </button>
          </details>
        </fieldset>
      </form>
      {!writable && (
        <label className="mt-5 block text-sm">
          自我介绍源码（只读，可复制）
          <textarea aria-label="正文" readOnly value={draft.bio} className={control} />
        </label>
      )}
      <section className="mt-5 rounded-xl border p-5" aria-label="只读工作经历">
        <h2 className="font-semibold">工作经历（来自时间戳模块，共{experience.length}条）</h2>
        <p className="text-muted-foreground mt-3 text-sm">
          此处数据与时间戳模块共用，请在时间戳中编辑。是否在关于我显示由独立开关控制。
        </p>
        <ul className="my-4 space-y-2 text-sm">
          {experience.map((item) => (
            <li key={item.id}>
              {item.title} · {item.showOnAbout ? 'About显示' : 'About隐藏'}
            </li>
          ))}
        </ul>
        <Link href="/admin/timeline" className="text-brand">
          去管理 →
        </Link>
      </section>
    </div>
  )
}
