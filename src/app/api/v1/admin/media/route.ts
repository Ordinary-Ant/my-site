import { apiHandler, ok } from '@/lib/api/http'
import { listMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
export const GET = apiHandler(async (request) => {
  const result = await listMedia(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
