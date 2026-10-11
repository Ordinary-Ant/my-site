import { apiHandler, ok } from '@/lib/api/http'
import { listPublicCategories } from '@/lib/services/taxonomy'
export const GET = apiHandler(async (request) => {
  const result = await listPublicCategories(new URL(request.url).searchParams)
  return ok(result)
})
