'use client'
import { api } from './client'
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
}
/** Local经multipart，R2先hash授权直传；确认成功前不把临时地址插入正文。 */
export async function uploadMedia(
  file: File,
  fields: { alt?: string; folder?: string } = {},
): Promise<MediaItem> {
  const config = await api<{ driver: 'local' | 's3' }>('/api/v1/admin/media/config')
  if (config.data.driver === 'local') {
    const form = new FormData()
    form.set('file', file)
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value)
    return (await api<MediaItem>('/api/v1/admin/media/upload', { method: 'POST', body: form })).data
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
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
  const response = await fetch(data.uploadUrl, {
    method: data.method,
    headers: data.headers,
    body: file,
  })
  if (!response.ok) throw new Error('文件直传失败，请稍后重试')
  return (
    await api<MediaItem>('/api/v1/admin/media/confirm', {
      method: 'POST',
      body: JSON.stringify({ intentId: data.intentId }),
    })
  ).data
}
