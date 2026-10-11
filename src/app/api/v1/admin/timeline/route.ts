import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { createTimeline, listAdminTimeline } from '@/lib/services/timeline'
export const GET = apiHandler(async (request) => {
  const result = await listAdminTimeline(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const result = ok(await createTimeline(await readJson(request), request))
  return new Response(result.body, { status: 201, headers: result.headers })
})
