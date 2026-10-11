import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { listAdminUsers, createUser } from '@/lib/services/user'
export const GET = apiHandler(async (request) => {
  const result = await listAdminUsers(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const response = ok(await createUser(await readJson(request), request))
  return new Response(response.body, { status: 201, headers: response.headers })
})
