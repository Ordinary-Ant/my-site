'use client'
import { useEffect, useRef, useState } from 'react'
import { uploadMedia, type MediaItem } from '@/lib/api/upload'
import { mediaAccept, mediaFileError, runMediaUploadQueue } from '@/lib/media-upload-queue'
type Job = {
  id: string
  file: File
  folder: string
  progress: number
  state: 'waiting' | 'running' | 'done' | 'failed'
  message: string
}
/** 文件仅留内存；三路上传互不回滚，失败项可独立重试。 */
export function MediaUploadQueue({
  folder,
  onComplete,
  onBusyChange,
  imagesOnly = false,
  initialFiles,
}: {
  folder: string
  onComplete: (items: MediaItem[]) => void
  onBusyChange?: (busy: boolean) => void
  imagesOnly?: boolean
  initialFiles?: File[]
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const locked = useRef(false),
    mounted = useRef(true),
    complete = useRef(onComplete),
    busyChanged = useRef(onBusyChange)
  complete.current = onComplete
  busyChanged.current = onBusyChange
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const patch = (id: string, value: Partial<Job>) => {
    if (mounted.current)
      setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...value } : job)))
  }
  const run = async (batch: Job[]) => {
    if (locked.current || !batch.length) return
    locked.current = true
    setBusy(true)
    busyChanged.current?.(true)
    const uploaded: MediaItem[] = []
    try {
      await runMediaUploadQueue(
        batch,
        async (job) => {
          patch(job.id, { state: 'running', progress: 0, message: '' })
          const invalid = mediaFileError(job.file)
          if (invalid || (imagesOnly && !job.file.type.startsWith('image/')))
            throw new Error(invalid || '此处仅可选择图片。')
          const item = await uploadMedia(
            job.file,
            { folder: job.folder, alt: job.file.name },
            { onProgress: (progress) => patch(job.id, { progress }) },
          )
          uploaded.push(item)
          patch(job.id, {
            state: 'done',
            progress: 100,
            message: item.deduplicated
              ? '已复用' + item.folder + '中的文件，保留原描述。'
              : '上传并验证成功。',
          })
        },
        (job, error) =>
          patch(job.id, {
            state: 'failed',
            message: error instanceof Error ? error.message : '上传失败。',
          }),
      )
      if (mounted.current && uploaded.length) complete.current(uploaded)
    } finally {
      locked.current = false
      if (mounted.current) {
        setBusy(false)
        busyChanged.current?.(false)
      }
    }
  }
  const enqueue = (files: File[]) => {
    if (locked.current) {
      setMessage('请等待当前上传结束后再添加文件。')
      return
    }
    if (files.length > 50) {
      setMessage('每批最多50个文件，请分批上传。')
      return
    }
    setMessage('')
    const batch: Job[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      folder,
      progress: 0,
      state: 'waiting',
      message: '',
    }))
    setJobs((current) => [...current, ...batch])
    void run(batch)
  }
  const enqueueRef = useRef(enqueue)
  enqueueRef.current = enqueue
  const initialBatch = useRef<File[] | undefined>(undefined)
  useEffect(() => {
    if (initialFiles?.length && initialBatch.current !== initialFiles) {
      initialBatch.current = initialFiles
      enqueueRef.current(initialFiles)
    }
  }, [initialFiles])
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length) {
        event.preventDefault()
        event.stopPropagation()
        enqueueRef.current(files)
      }
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (locked.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    document.addEventListener('paste', paste, true)
    window.addEventListener('beforeunload', unload)
    return () => {
      document.removeEventListener('paste', paste, true)
      window.removeEventListener('beforeunload', unload)
    }
  }, [])
  return (
    <section
      aria-label="上传队列"
      className="my-5 rounded-xl border border-dashed p-4"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault()
          event.stopPropagation()
          enqueue(Array.from(event.dataTransfer.files))
        }
      }}
    >
      <label className="inline-flex cursor-pointer rounded-lg border px-4 py-2 text-sm">
        {busy ? '正在上传…' : '上传文件 +'}
        <input
          aria-label="上传文件"
          type="file"
          multiple
          disabled={busy}
          accept={
            imagesOnly
              ? mediaAccept
                  .split(',')
                  .filter((type) => type.startsWith('image/'))
                  .join(',')
              : mediaAccept
          }
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            enqueue(files)
          }}
        />
      </label>
      <p className="text-muted-foreground mt-3 text-sm">
        可拖入文件或在此页面粘贴文件。图片≤10MB、视频≤50MB、PDF≤20MB；最多三路并发，100%表示验证完成。
      </p>
      {message && (
        <p role="alert" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {!!jobs.length && (
        <ul className="mt-4 space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-lg border p-3 text-sm">
              <p className="break-all">{job.file.name}</p>
              <progress
                aria-label={job.file.name + '上传进度'}
                max={100}
                value={job.progress}
                className="mt-2 w-full"
              />
              <p role="status" className="mt-1 break-words">
                {job.state === 'running'
                  ? '上传或验证中 ' + job.progress + '%'
                  : job.state === 'waiting'
                    ? '等待上传'
                    : job.message}
              </p>
              {job.state === 'failed' && (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded border px-3 py-1"
                  onClick={() => void run([job])}
                >
                  重试 {job.file.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!!jobs.length && (
        <button
          type="button"
          disabled={busy}
          className="mt-3 text-sm underline"
          onClick={() => setJobs([])}
        >
          清空已结束队列
        </button>
      )}
    </section>
  )
}
