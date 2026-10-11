import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { bulkDeleteTags } from '@/lib/services/taxonomy'
export const POST = apiHandler(async (request) =>
  ok(await bulkDeleteTags(await readJson(request), request)),
)
