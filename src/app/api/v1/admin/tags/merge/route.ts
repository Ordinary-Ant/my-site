import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { mergeTags } from '@/lib/services/taxonomy'
export const POST = apiHandler(async (request) =>
  ok(await mergeTags(await readJson(request), request)),
)
