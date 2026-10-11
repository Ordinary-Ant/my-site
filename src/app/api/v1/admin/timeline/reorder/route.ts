import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { reorderTimeline } from '@/lib/services/timeline'
export const PATCH = apiHandler(async (request) =>
  ok(await reorderTimeline(await readJson(request), request)),
)
