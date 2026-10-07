import 'server-only'
import { createHash } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import sharp from 'sharp'
import type { MediaKind } from '@prisma/client'
import { ApiError } from '@/lib/api/errors'

export const MEDIA_TYPES: Record<string, { kind: MediaKind; max: number; ext: string }> = {
  'image/png': { kind: 'IMAGE', max: 10 * 1024 * 1024, ext: 'png' },
  'image/jpeg': { kind: 'IMAGE', max: 10 * 1024 * 1024, ext: 'jpg' },
  'image/webp': { kind: 'IMAGE', max: 10 * 1024 * 1024, ext: 'webp' },
  'image/gif': { kind: 'IMAGE', max: 10 * 1024 * 1024, ext: 'gif' },
  'image/avif': { kind: 'IMAGE', max: 10 * 1024 * 1024, ext: 'avif' },
  'video/mp4': { kind: 'VIDEO', max: 50 * 1024 * 1024, ext: 'mp4' },
  'video/webm': { kind: 'VIDEO', max: 50 * 1024 * 1024, ext: 'webm' },
  'application/pdf': { kind: 'DOCUMENT', max: 20 * 1024 * 1024, ext: 'pdf' },
}
export function mediaType(mime: string, size: number) {
  const type = MEDIA_TYPES[mime]
  if (!type)
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA',
      '仅支持 PNG/JPEG/WebP/GIF/AVIF、MP4/WebM 和 PDF，拒绝 SVG/HTML',
    )
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new ApiError(400, 'INVALID_FILE', '文件不能为空')
  if (size > type.max) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '文件超过类型大小限制')
  return type
}
/** 只接受服务端生成的公开对象key，绝不把原始文件名当作路径。 */
export function safeStorageKey(key: string) {
  if (!/^media\/[a-f0-9-]{36}\.(png|jpg|webp|gif|avif|mp4|webm|pdf)$/.test(key))
    throw new ApiError(400, 'INVALID_KEY', '无效媒体路径')
  return key
}
export async function inspectMedia(bytes: Buffer, declared: string) {
  const type = mediaType(declared, bytes.length)
  let actual
  try {
    actual = await fileTypeFromBuffer(bytes)
  } catch {
    throw new ApiError(415, 'INVALID_FILE', '文件内容损坏')
  }
  if (!actual || actual.mime !== declared)
    throw new ApiError(415, 'UNSUPPORTED_MEDIA', '文件真实类型与声明不符')
  let width: number | undefined
  let height: number | undefined
  if (type.kind === 'IMAGE') {
    try {
      const image = sharp(bytes, { animated: true, limitInputPixels: 40000000, failOn: 'warning' })
      const metadata = await image.metadata()
      width = metadata.width
      height = metadata.pageHeight || metadata.height
      if (!width || !height) throw new Error('invalid dimensions')
      const pages = metadata.pages || 1
      if (pages > 500 || width * height * pages > 40000000) throw new Error('animation too large')
      // 完整解码所有帧，后续帧损坏或动画像素炸弹同样拒绝。
      await image.stats()
    } catch {
      throw new ApiError(415, 'INVALID_FILE', '图片损坏或尺寸过大')
    }
  }
  return {
    kind: type.kind,
    mimeType: actual.mime,
    ext: type.ext,
    size: bytes.length,
    width,
    height,
    hash: createHash('sha256').update(bytes).digest('hex'),
  }
}
