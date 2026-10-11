import { apiHandler, ok } from '@/lib/api/http'
import { listPublicTimeline } from '@/lib/services/timeline'
export const GET = apiHandler(async (request) => {
  const result = await listPublicTimeline(new URL(request.url).searchParams)
  return ok(result.data, result.meta)
})
