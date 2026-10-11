import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { bulkLogs } from '@/lib/services/log'
export const POST = apiHandler(async (request) =>
  ok(await bulkLogs(await readJson(request), request)),
)
