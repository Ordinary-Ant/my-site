import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { previewImport } from '@/lib/services/data'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) =>
  ok(await previewImport(await readJson(request), request)),
)
