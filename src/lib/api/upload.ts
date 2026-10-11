'use client'
import { api, ClientError, refreshSession } from './client'
import { mediaFileError } from '@/lib/media-upload-queue'
export type MediaItem = {
  id: string
  url: string
  originalName: string
  mimeType: string
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'
  size: number
  width: number | null
  height: number | null
  alt: string | null
  folder: string
  createdAt?: string
  deduplicated?: boolean
}
type UploadOptions = { onProgress?: (percent: number) => void }
/** 使用浏览器实际发送进度，90%以后留给服务端验证确认，不能把传完误报为成功。 */
function transfer(
  url: string,
  method: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  progress?: (percent: number) => void,
) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.timeout = 120000
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress?.(Math.min(90, Math.round((event.loaded / event.total) * 90)))
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText })
    xhr.onerror = () => reject(new Error('网络传输失败，请重试此文件。'))
    xhr.ontimeout = () => reject(new Error('文件上传超时，请重试此文件。'))
    xhr.onabort = () => reject(new Error('文件上传已取消。'))
    xhr.send(body)
  })
}
/** Local经multipart，R2先hash授权直传；确认成功前不把临时地址插入正文。 */
export async function uploadMedia(
  file: File,
  fields: { alt?: string; folder?: string } = {},
  options: UploadOptions = {},
): Promise<MediaItem> {
  const invalid = mediaFileError(file)
  if (invalid) throw new Error(invalid)
  options.onProgress?.(0)
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
  const existing = await api<{ media: MediaItem | null; deduplicated: boolean }>(
    '/api/v1/admin/media/deduplicate',
    { method: 'POST', body: JSON.stringify({ hash, size: file.size, mimeType: file.type }) },
  )
  if (existing.data.media) {
    options.onProgress?.(100)
    return { ...existing.data.media, deduplicated: true }
  }
  const config = await api<{ driver: 'local' | 's3' }>('/api/v1/admin/media/config')
  if (config.data.driver === 'local') {
    const form = new FormData()
    form.set('file', file)
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value)
    let response = await transfer(
      '/api/v1/admin/media/upload',
      'POST',
      form,
      {},
      options.onProgress,
    )
    if (response.status === 401 && (await refreshSession()))
      response = await transfer('/api/v1/admin/media/upload', 'POST', form, {}, options.onProgress)
    let payload
    try {
      payload = JSON.parse(response.text)
    } catch {
      throw new Error('上传服务响应异常，请重试此文件。')
    }
    if (response.status < 200 || response.status >= 300)
      throw new ClientError(
        response.status,
        payload.error?.code ?? 'UPLOAD_FAILED',
        payload.error?.message ?? '文件上传失败',
        0,
        payload.error?.details,
      )
    options.onProgress?.(100)
    return payload.data
  }
  const { data } = await api<{
    intentId: string
    uploadUrl: string
    method: string
    headers: Record<string, string>
  }>('/api/v1/admin/media/upload-intent', {
    method: 'POST',
    body: JSON.stringify({
      ...fields,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      hash,
    }),
  })
  const response = await transfer(
    data.uploadUrl,
    data.method,
    file,
    data.headers,
    options.onProgress,
  )
  if (response.status < 200 || response.status >= 300)
    throw new Error('文件直传失败，请重试此文件。')
  const result = (
    await api<MediaItem>('/api/v1/admin/media/confirm', {
      method: 'POST',
      body: JSON.stringify({ intentId: data.intentId }),
    })
  ).data
  options.onProgress?.(100)
  return result
}
