import { apiHandler, ok } from '@/lib/api/http'
import { listPublicLogs } from '@/lib/services/log'
export const GET = apiHandler(async (request) => {
  const result = await listPublicLogs(new URL(request.url).searchParams)
  return ok(result.data, result.meta)
})
