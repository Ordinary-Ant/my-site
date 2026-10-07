'use client'
import { useState } from 'react'

/** 复制已渲染代码，不把高亮库或正文解析器发送到浏览器。 */
export function CopyCode() {
  const [message, setMessage] = useState('复制代码')
  return (
    <button
      type="button"
      className="text-muted-foreground bg-background absolute top-2 right-3 rounded border px-2 py-1 text-xs"
      onClick={async (event) => {
        const text = event.currentTarget.parentElement?.querySelector('pre')?.textContent ?? ''
        try {
          await navigator.clipboard.writeText(text)
          setMessage('已复制')
        } catch {
          setMessage('请手动选择复制')
        }
      }}
      aria-live="polite"
    >
      {message}
    </button>
  )
}
