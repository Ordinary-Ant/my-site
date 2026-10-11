'use client'
import { useEffect, useState } from 'react'
import { safeProfileLink } from '@/lib/profile-display'
/** 开关已在服务端DTO执行；邮箱在允许公开时才传入并由浏览器展示。 */
export function ProfileContact({ email, phone }: { email?: string | null; phone?: string | null }) {
  const [ready, setReady] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => setReady(true), [])
  const [user, domain] = email?.split('@') ?? []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        {email && (
          <span data-user={user} data-domain={domain}>
            {ready ? (
              <>
                <a className="text-brand break-all" href={'mailto:' + email}>
                  {email}
                </a>
                <button
                  type="button"
                  className="ml-3 rounded border px-2 py-1 text-sm"
                  aria-label="复制邮箱"
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setMessage('当前环境不支持复制，请选择邮箱文字复制。')
                      return
                    }
                    void navigator.clipboard.writeText(email).then(
                      () => setMessage('已复制'),
                      () => setMessage('复制失败，请选择邮箱文字复制'),
                    )
                  }}
                >
                  复制
                </button>
              </>
            ) : (
              <span>邮箱将在浏览器中显示</span>
            )}
          </span>
        )}
        {phone && safeProfileLink('tel:' + phone) && (
          <a className="text-brand break-all" href={safeProfileLink('tel:' + phone)}>
            {phone}
          </a>
        )}
      </div>
      <p role="status" className="text-muted-foreground text-sm">
        {message}
      </p>
    </div>
  )
}
