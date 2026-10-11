'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ClientError } from '@/lib/api/client'
import {
  readUserQuery,
  userQueryString,
  userDraft,
  userPatch,
  userChangeRevokesSessions,
  type AdminUser,
  type UserDraft,
  type UserQuery,
} from '@/lib/user-controls'
import { useAdminUser } from './shell'
const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40'
const control = 'mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm'
const roleLabels = { ADMIN: '管理员', EDITOR: '编辑', VIEWER: '只读' }
type UserMeta = {
  total: number
  page: number
  pageSize: number
  totalPages: number
  activeAdmins: number
}
const emptyMeta: UserMeta = { total: 0, page: 1, pageSize: 20, totalPages: 1, activeAdmins: 0 }
/** 用户编辑保留原修订号，权限与会话撤销最终由服务层在事务内判断。 */
export function UserManager() {
  const actor = useAdminUser(),
    allowed = !!actor?.permissions.includes('user:manage')
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams(),
    query = readUserQuery(params)
  const queryKey = userQueryString(query)
  const [search, setSearch] = useState(query.q)
  const [rows, setRows] = useState<AdminUser[]>([]),
    [meta, setMeta] = useState(emptyMeta)
  const [editing, setEditing] = useState<AdminUser | null>(null),
    [draft, setDraft] = useState<UserDraft>(() => userDraft())
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [conflict, setConflict] = useState(false)
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null),
    [copied, setCopied] = useState(false)
  const mutation = useRef(false),
    mounted = useRef(true),
    loadSequence = useRef(0),
    dirtyRef = useRef(false),
    leaveAllowed = useRef(0),
    dialog = useRef<HTMLDialogElement>(null)
  const dirty = editing
    ? !!userPatch(draft, editing)
    : JSON.stringify(draft) !== JSON.stringify(userDraft())
  dirtyRef.current = dirty
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const load = useCallback(async () => {
    if (!allowed) return
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const response = await api<AdminUser[]>(
        '/api/v1/admin/users' + (queryKey ? '?' + queryKey : ''),
      )
      if (!mounted.current || sequence !== loadSequence.current) return
      setRows(response.data)
      setMeta(response.meta as UserMeta)
      const result = response.meta as UserMeta
      if (query.page > Math.max(1, result.totalPages))
        router.replace(
          path + '?' + userQueryString({ ...query, page: Math.max(1, result.totalPages) }),
          { scroll: false },
        )
    } catch (failure) {
      if (mounted.current && sequence === loadSequence.current) setError((failure as Error).message)
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false)
    }
    // 查询键覆盖所有筛选字段，编辑快照不随列表刷新改变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, queryKey, path, router])
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
    const timer = setTimeout(() => {
      const current = readUserQuery(new URLSearchParams(window.location.search))
      router.replace(path + '?' + userQueryString({ ...current, q: search, page: 1 }), {
        scroll: false,
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [search, query.q, path, router])
  useEffect(() => {
    if (secret && !dialog.current?.open) dialog.current?.showModal()
    else if (!secret && dialog.current?.open) dialog.current.close()
  }, [secret])
  useEffect(() => {
    const canLeave = () => {
      if (mutation.current) {
        setError('正在保存，请等待结果后离开。')
        return false
      }
      if (!dirtyRef.current || Date.now() < leaveAllowed.current) return true
      if (!window.confirm('用户资料尚未保存，确定放弃并离开？')) return false
      leaveAllowed.current = Date.now() + 500
      return true
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || mutation.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (anchor && new URL(anchor.href).pathname !== path && !canLeave()) event.preventDefault()
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    const navigate = (event: Event) => {
      const destination = (event as Event & { destination?: { url: string } }).destination
      if (
        event.cancelable &&
        destination &&
        new URL(destination.url).pathname !== path &&
        !canLeave()
      )
        event.preventDefault()
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    navigation?.addEventListener('navigate', navigate)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
      navigation?.removeEventListener('navigate', navigate)
    }
  }, [path])
  const choose = (user?: AdminUser) => {
    if (mutation.current || (dirty && !window.confirm('用户资料尚未保存，确定放弃当前修改？')))
      return
    setEditing(user ?? null)
    setDraft(userDraft(user))
    setError('')
    setMessage('')
    setConflict(false)
  }
  const changeQuery = (patch: Partial<UserQuery>) =>
    router.replace(path + '?' + userQueryString({ ...query, ...patch }), { scroll: false })
  const run = async (task: () => Promise<void>) => {
    if (!allowed || mutation.current) return
    mutation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setConflict(false)
    try {
      await task()
    } catch (failure) {
      if (!mounted.current) return
      setError((failure as Error).message)
      if (
        failure instanceof ClientError &&
        failure.status === 409 &&
        failure.code !== 'EMAIL_CONFLICT'
      ) {
        setConflict(true)
        setError('版本已变化，当前表单仍保留。请核对并加载最新资料后重试。' + failure.message)
      }
    } finally {
      mutation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const saved = (user: AdminUser, text: string) => {
    if (!mounted.current) return
    setEditing(user)
    setDraft(userDraft(user))
    setMessage(text)
    setConflict(false)
    // 写请求可能跨越筛选变化，完成时必须读取最新查询。
    void latestLoad.current()
  }
  const save = () => {
    const patch = editing ? userPatch(draft, editing) : null
    if (editing && !patch) {
      setMessage('没有需要保存的修改。')
      return
    }
    if (
      editing &&
      userChangeRevokesSessions(draft, editing) &&
      !window.confirm('邮箱、角色或停用状态变化将撤销此账号的全部会话，确定保存？')
    )
      return
    void run(async () => {
      if (editing) {
        const response = await api<AdminUser>('/api/v1/admin/users/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        if (response.data.id === actor?.id && response.data.email !== actor.email) {
          dirtyRef.current = false
          leaveAllowed.current = Date.now() + 1000
          mutation.current = false
          location.replace('/login?next=%2Fadmin%2Fusers')
          return
        }
        saved(response.data, '用户资料已保存。')
      } else {
        const response = await api<{ user: AdminUser; temporaryPassword: string }>(
          '/api/v1/admin/users',
          {
            method: 'POST',
            body: JSON.stringify({
              name: draft.name.trim(),
              email: draft.email.trim().toLowerCase(),
              role: draft.role,
              avatar: draft.avatar.trim() || null,
            }),
          },
        )
        saved(response.data.user, '用户已创建。请妥善交付临时密码。')
        if (mounted.current) {
          setSecret({ email: response.data.user.email, password: response.data.temporaryPassword })
          setCopied(false)
        }
      }
    })
  }
  const securityAction = (kind: 'reset-password' | 'revoke-sessions') => {
    if (!editing || editing.id === actor?.id) return
    if (dirty) {
      setError('请先保存或放弃资料修改，再执行账号安全操作。')
      return
    }
    const question =
      kind === 'reset-password'
        ? '确定随机重置密码并撤销此账号全部会话？'
        : '确定撤销此账号全部会话？'
    if (!window.confirm(question)) return
    void run(async () => {
      const response = await api<{ user: AdminUser; temporaryPassword?: string; revoked?: number }>(
        '/api/v1/admin/users/' + editing.id + '/' + kind,
        { method: 'POST', body: JSON.stringify({ revision: editing.revision }) },
      )
      saved(
        response.data.user,
        kind === 'reset-password'
          ? '密码已重置，全部会话已撤销。'
          : '已撤销' + response.data.revoked + '个会话。',
      )
      if (mounted.current && response.data.temporaryPassword) {
        setSecret({ email: response.data.user.email, password: response.data.temporaryPassword })
        setCopied(false)
      }
    })
  }
  const reloadEditing = () => {
    if (!editing || !window.confirm('加载最新资料会替换当前表单，确定继续？')) return
    void run(async () => {
      const response = await api<AdminUser>('/api/v1/admin/users/' + editing.id)
      saved(response.data, '已加载最新资料，请重新核对。')
    })
  }
  if (!allowed)
    return (
      <section>
        <h1 className="text-2xl font-bold">用户管理</h1>
        <p className="mt-5">仅管理员可以管理用户。</p>
      </section>
    )
  const self = editing?.id === actor?.id
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">用户管理</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            停用保留作者和审计记录；启用管理员 {meta.activeAdmins} 位。
          </p>
        </div>
        <button type="button" className={button} disabled={busy} onClick={() => choose()}>
          添加用户
        </button>
      </div>
      {error && (
        <p role="alert" className="text-destructive break-words whitespace-pre-wrap">
          {error}
        </p>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[1fr_360px]">
        <section className="min-w-0 space-y-4" aria-label="用户列表">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-0 grow text-sm">
              筛选用户
              <input
                aria-label="筛选用户"
                className={control}
                value={search}
                maxLength={200}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="姓名或邮箱"
              />
            </label>
            <label className="text-sm">
              角色
              <select
                aria-label="筛选用户角色"
                className={control}
                value={query.role}
                onChange={(event) =>
                  changeQuery({ role: event.target.value as UserQuery['role'], page: 1 })
                }
              >
                <option value="">全部角色</option>
                {Object.entries(roleLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              状态
              <select
                aria-label="筛选用户状态"
                className={control}
                value={query.active}
                onChange={(event) =>
                  changeQuery({ active: event.target.value as UserQuery['active'], page: 1 })
                }
              >
                <option value="">全部状态</option>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </label>
          </div>
          <p className="text-muted-foreground text-sm" role="status">
            {loading ? '正在读取用户…' : '共' + meta.total + '位用户'}
          </p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-3">姓名 / 邮箱</th>
                  <th className="p-3">角色</th>
                  <th className="p-3">状态</th>
                  <th className="p-3">最后登录</th>
                  <th className="p-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} className="border-t">
                    <td className="max-w-48 p-3 break-words">
                      <p className="font-semibold">
                        {user.name}
                        {user.id === actor?.id ? '（我）' : ''}
                      </p>
                      <p className="text-muted-foreground mt-1 break-all">{user.email}</p>
                    </td>
                    <td className="p-3 whitespace-nowrap">{roleLabels[user.role]}</td>
                    <td className="p-3 whitespace-nowrap">{user.isActive ? '启用' : '停用'}</td>
                    <td className="p-3 whitespace-nowrap">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString('zh-CN')
                        : '尚未登录'}
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        aria-label={'编辑用户 ' + user.email}
                        className={button}
                        disabled={busy || loading}
                        onClick={() => choose(user)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && rows.length === 0 && <p className="p-6 text-sm">没有匹配用户。</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={button}
              disabled={loading || query.page <= 1}
              onClick={() => changeQuery({ page: query.page - 1 })}
            >
              上一页
            </button>
            <span className="text-sm">
              第{query.page} / {Math.max(1, meta.totalPages)}页
            </span>
            <button
              className={button}
              disabled={loading || query.page >= meta.totalPages}
              onClick={() => changeQuery({ page: query.page + 1 })}
            >
              下一页
            </button>
            <select
              aria-label="每页用户数量"
              className={button + ' bg-background'}
              value={query.pageSize}
              onChange={(event) => changeQuery({ pageSize: Number(event.target.value), page: 1 })}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size}位 / 页
                </option>
              ))}
            </select>
          </div>
        </section>
        <section className="min-w-0 rounded-xl border p-5" aria-label="用户资料表单">
          <h2 className="text-lg font-semibold">{editing ? '编辑用户' : '添加用户'}</h2>
          {editing && (
            <p className="text-muted-foreground mt-2 text-xs">修订版本 {editing.revision}</p>
          )}
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <fieldset disabled={busy} className="space-y-4">
              <label className="block text-sm">
                姓名
                <input
                  aria-label="用户姓名"
                  className={control}
                  maxLength={200}
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                邮箱
                <input
                  aria-label="用户邮箱"
                  type="email"
                  autoComplete="off"
                  className={control}
                  maxLength={320}
                  required
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                头像地址
                <input
                  aria-label="用户头像地址"
                  className={control}
                  maxLength={2000}
                  value={draft.avatar}
                  onChange={(event) => setDraft({ ...draft, avatar: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                角色
                <select
                  aria-label="用户角色"
                  className={control}
                  disabled={self}
                  value={draft.role}
                  onChange={(event) =>
                    setDraft({ ...draft, role: event.target.value as UserDraft['role'] })
                  }
                >
                  {Object.entries(roleLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {editing && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    aria-label="启用用户"
                    type="checkbox"
                    disabled={self}
                    checked={draft.isActive}
                    onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                  />
                  启用用户
                </label>
              )}
              <p className="text-muted-foreground text-sm leading-relaxed">
                {self
                  ? '不能停用或降级自己。修改邮箱会撤销自己的会话并要求重新登录。'
                  : '角色、邮箱变化或停用将撤销此账号全部会话。'}
              </p>
              {!editing && (
                <p className="text-muted-foreground text-sm">
                  密码由服务端随机生成，创建成功后展示一次。
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <button type="submit" className={button + ' bg-primary text-primary-foreground'}>
                  {busy ? '正在处理…' : editing ? '保存用户' : '创建用户'}
                </button>
                {dirty && (
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      if (window.confirm('确定放弃当前修改？')) {
                        setDraft(userDraft(editing ?? undefined))
                        setError('')
                        setConflict(false)
                      }
                    }}
                  >
                    放弃修改
                  </button>
                )}
                {conflict && editing && (
                  <button type="button" className={button} onClick={reloadEditing}>
                    加载最新资料
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          {editing && (
            <fieldset disabled={busy} className="mt-6 space-y-3 border-t pt-5">
              <h3 className="font-semibold">账号安全</h3>
              {self ? (
                <Link href="/admin/account" className="text-brand text-sm underline">
                  前往个人设置修改密码与管理会话
                </Link>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={button}
                    onClick={() => securityAction('reset-password')}
                  >
                    重置密码
                  </button>
                  <button
                    type="button"
                    className={button}
                    onClick={() => securityAction('revoke-sessions')}
                  >
                    撤销全部会话
                  </button>
                </div>
              )}
            </fieldset>
          )}
        </section>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="temporary-password-title"
        className="bg-background text-foreground m-auto w-[calc(100%_-_24px)] max-w-lg rounded-xl border p-6 backdrop:bg-black/70"
        onClose={() => {
          setSecret(null)
          setCopied(false)
        }}
      >
        <h2 id="temporary-password-title" className="text-lg font-semibold">
          临时密码仅展示一次
        </h2>
        <p className="mt-4 text-sm break-all">{secret?.email}</p>
        <p className="text-muted-foreground mt-3 text-sm">
          关闭后不能再次查看，可重新重置。请在首次登录后前往个人设置修改密码。
        </p>
        <label className="mt-4 block text-sm">
          临时密码
          <input
            aria-label="临时密码"
            className={control + ' font-mono'}
            readOnly
            autoComplete="off"
            spellCheck={false}
            value={secret?.password ?? ''}
            onFocus={(event) => event.target.select()}
          />
        </label>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className={button}
            onClick={() => {
              if (secret)
                void navigator.clipboard.writeText(secret.password).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
            }}
          >
            {copied ? '已复制' : '复制密码'}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setSecret(null)
              setCopied(false)
            }}
          >
            关闭并清除
          </button>
        </div>
      </dialog>
    </div>
  )
}
