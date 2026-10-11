import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { createProject, listAdminProjects } from '@/lib/services/project'
export const GET = apiHandler(async (request) => {
  const result = await listAdminProjects(new URL(request.url).searchParams, request)
  return ok(result.data, result.meta)
})
export const POST = apiHandler(async (request) => {
  const result = ok(await createProject(await readJson(request), request))
  return new Response(result.body, { status: 201, headers: result.headers })
})
