'use client'
import { useEffect, useRef } from 'react'

/** 原生模态框负责焦点圈定、Esc和关闭后回焦，避免只盖一层视觉遮罩。 */
export function AdminDialog({
  open,
  title,
  onClose,
  children,
  drawer = false,
  busy = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  drawer?: boolean
  busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current?.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
      className={
        'bg-background text-foreground shadow-card border backdrop:bg-black/40 ' +
        (drawer
          ? 'fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-dvh w-full max-w-lg'
          : 'm-auto w-[calc(100%_-_32px)] max-w-lg rounded-xl')
      }
    >
      <section className="p-6">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={'关闭' + title}>
            ✕
          </button>
        </header>
        {children}
      </section>
    </dialog>
  )
}
