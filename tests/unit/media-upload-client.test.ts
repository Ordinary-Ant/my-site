import { afterEach, expect, test, vi } from 'vitest'
vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
  refreshSession: vi.fn(),
  ClientError: class extends Error {},
}))
import { api } from '@/lib/api/client'
import { uploadMedia } from '@/lib/api/upload'
const media = {
  id: 'verified',
  url: '/verified.png',
  originalName: 'original.png',
  alt: '原描述',
  folder: '/original',
}
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
test('已验证文件hash命中直接复用，不传输字节且保留原目录与alt', async () => {
  vi.mocked(api).mockResolvedValueOnce({ data: { media, deduplicated: true } })
  const result = await uploadMedia(new File(['same'], 'same.png', { type: 'image/png' }), {
    alt: '不覆盖',
    folder: '/new',
  })
  expect(result).toEqual({ ...media, deduplicated: true })
  expect(api).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api).mock.calls[0][0]).toBe('/api/v1/admin/media/deduplicate')
  const body = JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string)
  expect(body.hash).toMatch(/^[a-f0-9]{64}$/)
  expect(body).not.toHaveProperty('alt')
})
test('Local真实传输边界使用multipart且报告进度', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ data: { media: null, deduplicated: false } })
    .mockResolvedValueOnce({ data: { driver: 'local' } })
  let body: unknown
  class Xhr {
    upload: {
      onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void
    } = {}
    status = 201
    responseText = JSON.stringify({ success: true, data: media })
    onload?: () => void
    open = vi.fn()
    setRequestHeader = vi.fn()
    send(value: unknown) {
      body = value
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 })
        this.onload?.()
      })
    }
  }
  vi.stubGlobal('XMLHttpRequest', Xhr)
  const progress: number[] = []
  const result = await uploadMedia(
    new File(['data'], 'new.png', { type: 'image/png' }),
    {},
    { onProgress: (value) => progress.push(value) },
  )
  expect(body).toBeInstanceOf(FormData)
  expect(result.id).toBe(media.id)
  expect(progress.some((value) => value > 0 && value < 100)).toBe(true)
  expect(progress.at(-1)).toBe(100)
})
test('R2传输完成仍等待服务端确认，不提前报告100%', async () => {
  let confirmed!: (value: { data: typeof media }) => void
  const pending = new Promise<{ data: typeof media }>((resolve) => {
    confirmed = resolve
  })
  vi.mocked(api)
    .mockResolvedValueOnce({ data: { media: null, deduplicated: false } })
    .mockResolvedValueOnce({ data: { driver: 's3' } })
    .mockResolvedValueOnce({
      data: {
        intentId: 'private-intent',
        uploadUrl: 'https://private.example/temporary',
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
      },
    })
    .mockImplementationOnce(() => pending)
  let sent: unknown
  class Xhr {
    upload: {
      onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void
    } = {}
    status = 200
    responseText = ''
    onload?: () => void
    open = vi.fn()
    setRequestHeader = vi.fn()
    send(value: unknown) {
      sent = value
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 })
        this.onload?.()
      })
    }
  }
  vi.stubGlobal('XMLHttpRequest', Xhr)
  const progress: number[] = []
  const result = uploadMedia(
    new File(['data'], 'new.png', { type: 'image/png' }),
    {},
    { onProgress: (value) => progress.push(value) },
  )
  await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(4))
  expect(sent).toBeInstanceOf(File)
  expect(progress).not.toContain(100)
  expect(vi.mocked(api).mock.calls[3][0]).toBe('/api/v1/admin/media/confirm')
  confirmed({ data: media })
  expect((await result).id).toBe(media.id)
  expect(progress.at(-1)).toBe(100)
})
