import { apiHandler, ok } from '@/lib/api/http'
import { searchPublicContent } from '@/lib/services/search'
import { consumeRateLimit } from '@/lib/services/rate-limit'
import { requestInfo } from '@/lib/services/auth'
export const GET = apiHandler(async (request) => {
  await consumeRateLimit(`public:${requestInfo(request).ip}`, 300, 900000)
  const result = await searchPublicContent(new URL(request.url).searchParams)
  return ok(result.data, result.meta)
})
