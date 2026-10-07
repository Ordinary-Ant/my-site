import { apiHandler, ok } from '@/lib/api/http'
import { ApiError } from '@/lib/api/errors'
import { requirePermission } from '@/lib/services/auth'
import { uploadLocalMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  await requirePermission('media:write', request)
  const size = Number(request.headers.get('content-length'))
  if (size > 51 * 1024 * 1024) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '上传请求超过限制')
  // 即便客户端省略或伪造Content-Length，也在读取过程中硬限制请求体。
  if (!request.body) throw new ApiError(400, 'INVALID_FILE', '缺少上传内容')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let actualSize = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    actualSize += value.length
    if (actualSize > 51 * 1024 * 1024) {
      await reader.cancel()
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '上传请求超过限制')
    }
    chunks.push(value)
  }
  const data = await new Response(Buffer.concat(chunks), {
    headers: { 'Content-Type': request.headers.get('content-type') || '' },
  }).formData()
  const file = data.get('file')
  if (!(file instanceof File)) throw new ApiError(400, 'INVALID_FILE', '请选择文件')
  const input = {
    ...(data.has('alt') ? { alt: data.get('alt') } : {}),
    ...(data.has('folder') ? { folder: data.get('folder') } : {}),
  }
  const response = ok(await uploadLocalMedia(file, input, request))
  return new Response(response.body, { status: 201, headers: response.headers })
})
