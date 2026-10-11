import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { createLog, listAdminLogs } from '@/lib/services/log'
export const GET = apiHandler(async (request) => {
  const result = await listAdminLogs(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const result = ok(await createLog(await readJson(request), request))
  return new Response(result.body, { status: 201, headers: result.headers })
})
