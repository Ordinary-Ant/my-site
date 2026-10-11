import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { importData } from '@/lib/services/data'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) =>
  ok(await importData(await readJson(request), request)),
)
