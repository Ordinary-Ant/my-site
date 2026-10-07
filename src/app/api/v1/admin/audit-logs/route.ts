import { apiHandler, ok } from '@/lib/api/http'
import { listAuditLogs } from '@/lib/services/audit'
export const GET = apiHandler(async (req) => {
  const r = await listAuditLogs(new URL(req.url).searchParams, req)
  return ok(r.data, r.meta)
})
