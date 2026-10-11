'use client'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { safeContentUrl } from '@/lib/markdown'

function GalleryImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <div
      role="img"
      aria-label={alt + '（图片暂不可用）'}
      className="bg-muted flex aspect-video items-center justify-center rounded-lg p-6 text-sm"
    >
      图片暂不可用
    </div>
  ) : (
    <Image
      src={src}
      alt={alt}
      width={1200}
      height={800}
      unoptimized
      className="h-full w-full rounded-lg object-contain"
      onError={() => setFailed(true)}
    />
  )
}
/** 缩略图无JS可直接打开；启用JS后使用原生dialog支持方向键、Esc和回焦。 */
export default function ImageGallery({
  images,
  title,
  feature = false,
}: {
  images: string[]
  title: string
  feature?: boolean
}) {
  const sources = images.map(safeContentUrl).filter((src): src is string => !!src)
  const [selected, setSelected] = useState<number | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (selected !== null && !dialog.current?.open) dialog.current?.showModal()
    if (selected === null && dialog.current?.open) dialog.current?.close()
  }, [selected])
  if (!sources.length) return null
  const shift = (delta: number) =>
    setSelected((previous) =>
      previous === null ? null : (previous + delta + sources.length) % sources.length,
    )
  return (
    <section aria-label="图片图集" className="my-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sources.map((src, index) => (
          <a
            key={src + index}
            href={src}
            aria-label={'打开图集第' + (index + 1) + '张'}
            className={
              'bg-muted aspect-video overflow-hidden rounded-lg ' +
              (feature && index === 0 ? 'col-span-2 sm:col-span-3' : '')
            }
            onClick={(event) => {
              event.preventDefault()
              setSelected(index)
            }}
          >
            <GalleryImage src={src} alt={title + '图集' + (index + 1)} />
          </a>
        ))}
      </div>
      <dialog
        ref={dialog}
        aria-label="图集查看"
        className="bg-background text-foreground m-auto w-[calc(100%_-_24px)] max-w-5xl rounded-xl border p-4 backdrop:bg-black/70"
        onCancel={(event) => {
          event.preventDefault()
          setSelected(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            shift(-1)
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            shift(1)
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null)
        }}
      >
        <header className="mb-4 flex justify-between gap-4 text-sm">
          <span>
            {selected !== null ? selected + 1 : 0}/{sources.length}
          </span>
          <button aria-label="关闭图集" onClick={() => setSelected(null)}>
            ✕
          </button>
        </header>
        {selected !== null && (
          <div
            className="max-h-[75vh] overflow-auto"
            onTouchStart={(event) => {
              touch.current =
                event.touches.length === 1
                  ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
                  : null
            }}
            onTouchEnd={(event) => {
              const start = touch.current
              touch.current = null
              const end = event.changedTouches[0]
              if (!start || !end) return
              const dx = end.clientX - start.x,
                dy = end.clientY - start.y
              // 仅明确横向手势切图，纵向阅读与双指缩放交给浏览器。
              if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) shift(dx < 0 ? 1 : -1)
            }}
          >
            <GalleryImage
              key={sources[selected]}
              src={sources[selected]}
              alt={title + '图集' + (selected + 1)}
            />
          </div>
        )}
        <footer className="mt-4 flex justify-between">
          <button aria-label="上一张图片" onClick={() => shift(-1)}>
            ← 上一张
          </button>
          <button aria-label="下一张图片" onClick={() => shift(1)}>
            下一张 →
          </button>
        </footer>
        {sources.length > 1 && (
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {sources.map((src, index) => (
              <button
                key={src + index}
                aria-label={'切换到图集第' + (index + 1) + '张'}
                aria-pressed={selected === index}
                className="bg-muted aria-pressed:border-brand size-14 shrink-0 overflow-hidden rounded-lg border"
                onClick={() => setSelected(index)}
              >
                <GalleryImage src={src} alt={'图集缩略图' + (index + 1)} />
              </button>
            ))}
          </div>
        )}
      </dialog>
    </section>
  )
}
