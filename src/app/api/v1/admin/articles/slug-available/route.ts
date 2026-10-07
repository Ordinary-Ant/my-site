import { apiHandler, ok } from '@/lib/api/http'
import { slugAvailable } from '@/lib/services/article'
export const GET = apiHandler(async (request) => {
  const params = new URL(request.url).searchParams
  return ok(await slugAvailable(params.get('slug') ?? '', params.get('excludeId'), request))
})
