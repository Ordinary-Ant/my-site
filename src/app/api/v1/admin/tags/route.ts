import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { listAdminTags, createTag } from '@/lib/services/taxonomy'
export const GET = apiHandler(async (request) => {
  const result = await listAdminTags(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const result = ok(await createTag(await readJson(request), request))
  return new Response(result.body, { status: 201, headers: result.headers })
})
