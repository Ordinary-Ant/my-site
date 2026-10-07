import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { createArticle, listAdminArticles } from '@/lib/services/article'
export const GET = apiHandler(async (request) => {
  const result = await listAdminArticles(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const response = ok(await createArticle(await readJson(request), request))
  return new Response(response.body, { status: 201, headers: response.headers })
})
