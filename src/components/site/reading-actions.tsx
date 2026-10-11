'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
/** 返回有站内链接兜底，复制失败保留明确反馈。 */
export function ReadingActions({ route, backOnly = false }: { route: string; backOnly?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [message, setMessage] = useState('')
  const [returnUrl, setReturnUrl] = useState(route)
  useEffect(() => {
    setReturnUrl(route)
    try {
      const saved = JSON.parse(sessionStorage.getItem('log-return') ?? 'null')
      if (typeof saved.list === 'string' && saved.list.split('?')[0] === route) {
        setReturnUrl(saved.list)
      }
    } catch {}
  }, [route, pathname])
  return (
    <div className="mt-6 flex flex-wrap items-center gap-5 text-sm">
      <a
        href={returnUrl}
        className="text-brand"
        onClick={(event) => {
          if (returnUrl) {
            event.preventDefault()
            router.push(returnUrl, { scroll: false })
          }
        }}
      >
        ← 返回日志列表
      </a>
      {!backOnly && (
        <button
          className="text-brand"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href)
              setMessage('链接已复制')
            } catch {
              setMessage('复制未成功，可从地址栏复制')
            }
          }}
        >
          复制链接
        </button>
      )}
      <span role="status">{message}</span>
    </div>
  )
}
