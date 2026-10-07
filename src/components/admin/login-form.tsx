/* eslint-disable @next/next/no-html-link-for-pages -- 登录返回与错误恢复使用完整导航，避免依赖失败的客户端路由。 */
'use client'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, ClientError, safeNext } from '@/lib/api/client'
/** 登录表单只接收安全站内next，凭证由服务端HttpOnly Cookie保存。 */
export function LoginForm() {
  const params = useSearchParams()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <a href="/" className="text-brand text-sm">
          ← 返回网站
        </a>
        <h1 className="mt-8 text-3xl font-bold">欢迎回来</h1>
        <p className="text-muted-foreground mt-3 mb-8">登录你的个人网站管理后台</p>
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            const form = new FormData(event.currentTarget)
            try {
              await api('/api/v1/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
              })
              location.assign(safeNext(params.get('next')))
            } catch (error) {
              setError(error instanceof Error ? error.message : '登录失败')
              if (error instanceof ClientError && error.status === 429)
                setCooldown(error.retryAfter)
              setBusy(false)
            }
          }}
        >
          <label className="block text-sm">
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-2 w-full rounded-lg border bg-transparent px-3 py-3"
            />
          </label>
          <label className="block text-sm">
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-lg border bg-transparent px-3 py-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <button
            disabled={busy || cooldown > 0}
            className="bg-primary text-primary-foreground w-full rounded-lg py-3 font-medium disabled:opacity-60"
          >
            {cooldown > 0 ? `${cooldown} 秒后重试` : busy ? '正在登录…' : '登录'}
          </button>
        </form>
      </div>
    </main>
  )
}
