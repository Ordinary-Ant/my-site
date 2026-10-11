import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { listAdminCategories, createCategory } from '@/lib/services/taxonomy'
export const GET = apiHandler(async (request) => {
  const result = await listAdminCategories(request)
  return ok(result)
})
export const POST = apiHandler(async (request) => {
  const result = ok(await createCategory(await readJson(request), request))
  return new Response(result.body, { status: 201, headers: result.headers })
})
