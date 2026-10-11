import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { bulkProjects } from '@/lib/services/project'
export const POST = apiHandler(async (request) =>
  ok(await bulkProjects(await readJson(request), request)),
)
