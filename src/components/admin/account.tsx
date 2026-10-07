'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAdminUser } from './shell'
type Session = {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  expiresAt: string
}
/** 密码与会话管理始终调用服务授权接口，客户端只显示本人设备信息。 */
export function Account() {
  const user = useAdminUser()
  const [sessions, setSessions] = useState<Session[]>([])
  const [message, setMessage] = useState('')
  const load = async () => {
    try {
      setSessions((await api<Session[]>('/api/v1/auth/sessions')).data)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">个人设置</h1>
      {message && (
        <p role="status" className="my-4 rounded-lg border p-3">
          {message}
        </p>
      )}
      <section className="mt-8 rounded-xl border p-5">
        <h2 className="mb-4 font-semibold">修改密码</h2>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget
            const values = new FormData(form)
            if (values.get('newPassword') !== values.get('confirm')) {
              setMessage('两次新密码不一致')
              return
            }
            try {
              await api('/api/v1/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                  currentPassword: values.get('currentPassword'),
                  newPassword: values.get('newPassword'),
                }),
              })
              setMessage('密码已修改，其他设备已退出')
              form.reset()
              await load()
            } catch (error) {
              setMessage((error as Error).message)
            }
          }}
        >
          <label className="block text-sm">
            当前密码
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
          </label>
          <label className="block text-sm">
            新密码
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
            <span className="text-muted-foreground mt-2 block text-xs">
              至少8位，含大小写字母和数字。
            </span>
          </label>
          <label className="block text-sm">
            确认新密码
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="mt-2 w-full rounded-lg border bg-transparent p-2"
            />
          </label>
          <button className="bg-primary text-primary-foreground rounded-lg px-4 py-2">
            保存新密码
          </button>
        </form>
      </section>
      <section className="mt-8">
        <div className="flex justify-between">
          <h2 className="font-semibold">登录设备</h2>
          <button
            className="text-destructive text-sm"
            onClick={async () => {
              if (!confirm('退出全部设备，包括当前设备？')) return
              try {
                await api('/api/v1/auth/logout-all', { method: 'POST' })
                location.assign('/login')
              } catch (error) {
                setMessage((error as Error).message)
              }
            }}
          >
            退出全部设备
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {sessions.map((session) => (
            <div
              className="flex items-center justify-between gap-4 rounded-xl border p-4 text-sm"
              key={session.id}
            >
              <div className="min-w-0">
                <p className="break-words">{session.userAgent ?? '未知设备'}</p>
                <p className="text-muted-foreground mt-2">
                  {session.ip ?? 'unknown'} ·{' '}
                  {session.id === user?.sessionId ? '当前设备' : '其他设备'}
                </p>
              </div>
              <button
                className="text-destructive shrink-0"
                onClick={async () => {
                  try {
                    await api(`/api/v1/auth/sessions/${session.id}`, { method: 'DELETE' })
                    if (session.id === user?.sessionId) location.assign('/login')
                    else await load()
                  } catch (error) {
                    setMessage((error as Error).message)
                  }
                }}
              >
                撤销
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
