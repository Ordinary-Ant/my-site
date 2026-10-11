import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { reorderCategories } from '@/lib/services/taxonomy'
export const PATCH = apiHandler(async (request) =>
  ok(await reorderCategories(await readJson(request), request)),
)
