import { apiHandler, ok } from '@/lib/api/http'
import { getPublicArticle } from '@/lib/services/article'
import { consumeRateLimit } from '@/lib/services/rate-limit'
import { requestInfo } from '@/lib/services/auth'
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  return apiHandler(async (req) => {
    await consumeRateLimit(`public:${requestInfo(req).ip}`, 300, 900000)
    return ok(await getPublicArticle(slug))
  })(request)
}
