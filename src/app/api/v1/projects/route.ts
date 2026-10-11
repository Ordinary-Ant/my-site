import { apiHandler, ok } from '@/lib/api/http'
import { listPublicProjects } from '@/lib/services/project'
export const GET = apiHandler(async (request) => {
  const result = await listPublicProjects(new URL(request.url).searchParams)
  return ok(result.data, result.meta)
})
