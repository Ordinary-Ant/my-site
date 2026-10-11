import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { deduplicateMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) =>
  ok(await deduplicateMedia(await readJson(request), request)),
)
