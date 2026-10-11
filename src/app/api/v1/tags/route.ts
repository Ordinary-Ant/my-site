import { apiHandler, ok } from '@/lib/api/http'
import { listPublicTags } from '@/lib/services/taxonomy'
export const GET = apiHandler(async (request) => {
  const result = await listPublicTags(new URL(request.url).searchParams)
  return ok(result.data, result.meta)
})
