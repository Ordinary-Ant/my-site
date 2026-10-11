import { apiHandler, ok } from '@/lib/api/http'
import { projectSlugAvailable } from '@/lib/services/project'
export const GET = apiHandler(async (request) => {
  const params = new URL(request.url).searchParams
  return ok(await projectSlugAvailable(params.get('slug') ?? '', params.get('excludeId'), request))
})
