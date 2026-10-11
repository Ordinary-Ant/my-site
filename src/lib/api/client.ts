'use client'
/** 登录后跳转只接受站内路径，拒绝协议、反斜线与编码绕过。 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value))
    return '/admin'
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u0020]/.test(decoded)) return '/admin'
  } catch {
    return '/admin'
  }
  return value
}

export class ClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter = 0,
    public details?: { path: string; message: string }[],
  ) {
    super(message)
  }
}
let refreshing: Promise<boolean> | undefined
/** 单标签Promise去重、跨标签Web Locks排队，服务器宽限处理不支持锁的浏览器。 */
export function refreshSession() {
  if (refreshing) return refreshing
  const run = async () => {
    const me = await fetch('/api/v1/auth/me', { cache: 'no-store' })
    if (me.ok) return true
    return (await fetch('/api/v1/auth/refresh', { method: 'POST' })).ok
  }
  refreshing = (async () =>
    typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request('personal-site-auth-refresh', run)
      : await run())().finally(() => {
    refreshing = undefined
  })
  return refreshing
}

/** JSON入口在401时只刷新一次，409保持原稿交给编辑器处理。 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<{ data: T; meta?: { total: number; page: number; totalPages: number } }> {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  })
  if (response.status === 401 && retry && !path.startsWith('/api/v1/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false)
    if (path.startsWith('/api/v1/admin/'))
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  }
  if (response.status === 204) return { data: undefined as T }
  const body = await response.json()
  if (!response.ok)
    throw new ClientError(
      response.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? '请求失败',
      Number(response.headers.get('retry-after')) || 0,
      Array.isArray(body.error?.details) ? body.error.details : undefined,
    )
  return body
}
