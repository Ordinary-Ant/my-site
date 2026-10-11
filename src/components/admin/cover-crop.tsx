'use client'
import { useEffect, useRef, useState } from 'react'
import { cropRectangle } from '@/lib/image-crop'

/** 使用本地文件选择裁切区域；确认后仍走服务端媒体类型、大小与权限校验。 */
export function CoverCrop({
  onUpload,
  disabled,
}: {
  onUpload: (file: File) => Promise<void>
  disabled: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50)
  const [error, setError] = useState(''),
    [working, setWorking] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!file) {
      setImage(null)
      return
    }
    const url = URL.createObjectURL(file),
      source = new window.Image()
    let active = true
    source.onload = () => {
      if (!active) return
      if (source.naturalWidth * source.naturalHeight > 40000000)
        setError('图片尺寸超过4000万像素，请先缩小原图')
      else setImage(source)
    }
    source.onerror = () => {
      if (active) setError('图片无法解码，请重新选择')
    }
    source.src = url
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [file])
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!image || !context) return
    const box = cropRectangle(image.naturalWidth, image.naturalHeight, zoom, x, y)
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, 800, 450)
  }, [image, zoom, x, y])
  const confirm = async () => {
    if (!image || !file || !canvas.current || working) return
    setWorking(true)
    setError('')
    try {
      const result = document.createElement('canvas')
      result.width = 1600
      result.height = 900
      const context = result.getContext('2d')
      if (!context) throw new Error('浏览器不支持图片裁切')
      const box = cropRectangle(image.naturalWidth, image.naturalHeight, zoom, x, y)
      context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, 1600, 900)
      const blob = await new Promise<Blob>((resolve, reject) =>
        result.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('图片导出失败'))),
          'image/webp',
          0.9,
        ),
      )
      await onUpload(
        new File([blob], file.name.replace(/\.[^.]+$/, '') + '-cover.webp', { type: 'image/webp' }),
      )
      setFile(null)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setWorking(false)
    }
  }
  return (
    <section aria-label="作品封面裁切" className="space-y-3 rounded-lg border p-4">
      <label className="block text-sm">
        选择封面并裁切为16:9
        <input
          aria-label="选择裁切封面"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          disabled={disabled || working}
          className="mt-2 block w-full"
          onChange={(event) => {
            const next = event.target.files?.[0]
            if (next) {
              if (next.size > 10 * 1024 * 1024) {
                setError('原图超过10MB，请先压缩')
                event.target.value = ''
                return
              }
              setError('')
              setImage(null)
              setZoom(1)
              setX(50)
              setY(50)
              setFile(next)
            }
            event.target.value = ''
          }}
        />
      </label>
      {file && (
        <>
          <canvas
            ref={canvas}
            width={800}
            height={450}
            aria-label="16:9封面裁切预览"
            className="bg-muted aspect-video w-full rounded"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['缩放', zoom, setZoom, 1, 4, 0.1],
                ['水平位置', x, setX, 0, 100, 1],
                ['垂直位置', y, setY, 0, 100, 1],
              ] as const
            ).map(([label, value, set, min, max, step]) => (
              <label key={label} className="text-sm">
                {label}
                <input
                  aria-label={'裁切' + label}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  disabled={working}
                  onChange={(event) => set(Number(event.target.value))}
                  className="block w-full"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled || working || !image}
            onClick={() => void confirm()}
            className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm"
          >
            {working ? '正在上传裁切封面…' : '应用裁切并上传封面'}
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => setFile(null)}
            className="ml-4 text-sm"
          >
            取消裁切
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  )
}
