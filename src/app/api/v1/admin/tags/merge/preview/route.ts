import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { previewTagMerge } from '@/lib/services/taxonomy'
export const POST = apiHandler(async (request) =>
  ok(await previewTagMerge(await readJson(request), request)),
)
