'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MediaBrowser } from './media-library'
import type { MediaItem } from '@/lib/api/upload'
/** 原生模态框负责焦点与Escape；上传或写入期间保留队列等待确认。 */
export function MediaPicker({
  open,
  onClose,
  onSelect,
  imagesOnly = false,
  initialFiles,
  onBusyChange,
}: {
  open: boolean
  onClose: () => void
  onSelect: (item: MediaItem) => void
  imagesOnly?: boolean
  initialFiles?: File[]
  onBusyChange?: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  if (!mounted) return null
  // 脱离宿主表单DOM，并隔离React事件，避免目录操作误保存正文。
  return createPortal(
    <dialog
      ref={dialog}
      aria-label="选择媒体库文件"
      className="bg-background text-foreground m-auto max-h-[90vh] w-[calc(100%_-_24px)] max-w-5xl overflow-auto rounded-xl border p-5 backdrop:bg-black/70"
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          autoFocus
          disabled={busy}
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          onClick={onClose}
        >
          取消选择
        </button>
      </div>
      {open && (
        <MediaBrowser
          initialFiles={initialFiles}
          imagesOnly={imagesOnly}
          onBusyChange={setBusy}
          onSelect={(item) => {
            onSelect(item)
            onClose()
          }}
        />
      )}
    </dialog>,
    document.body,
  )
}
