import { ApiError } from './errors'
/** JSON正文设上限并统一400错误，防止格式错误变成内部异常。 */
export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > 4_200_000) throw new ApiError(413, 'BODY_TOO_LARGE', '请求正文过大')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'INVALID_JSON', '请求JSON格式不正确')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 4_200_000) {
      await reader.cancel()
      throw new ApiError(413, 'BODY_TOO_LARGE', '请求正文过大')
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '请求JSON格式不正确')
  }
}
