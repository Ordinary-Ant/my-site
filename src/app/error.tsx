'use client'

import { useEffect } from 'react'

/**
 * 全局错误边界
 *
 * 设计约定：崩溃不白屏，给出错误编号与重试入口。
 * 见 docs/04-admin-console.md §14
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // TODO(M4)：接入 Sentry
    console.error('[app error]', error)
  }, [error])

  return (
    <div className="container-page grid min-h-[70vh] place-items-center py-20">
      <div className="w-full max-w-md text-center">
        <div className="bg-destructive/10 text-destructive mx-auto grid size-14 place-items-center rounded-2xl text-2xl">
          !
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">出了点问题</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          页面渲染时发生错误。可以先重试一次；如果反复出现，请把下面的编号发给我。
        </p>

        {error.digest && (
          <div className="bg-muted text-muted-foreground mt-4 rounded-lg px-3 py-2 font-mono text-[12px]">
            {error.digest}
          </div>
        )}

        <div className="mt-6 flex justify-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground hover:bg-brand-hover rounded-[10px] px-5 py-2.5 text-sm font-medium transition-colors"
          >
            重试
          </button>
          <a
            href="/"
            className="border-border-strong hover:bg-muted rounded-[10px] border px-5 py-2.5 text-sm font-medium transition-colors"
          >
            回首页
          </a>
        </div>
      </div>
    </div>
  )
}
