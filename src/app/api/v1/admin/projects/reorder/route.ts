import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { reorderProjects } from '@/lib/services/project'
export const PATCH = apiHandler(async (request) =>
  ok(await reorderProjects(await readJson(request), request)),
)
