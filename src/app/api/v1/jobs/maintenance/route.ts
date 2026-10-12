import { apiHandler, ok } from '@/lib/api/http'
import { authorizePublicationJob } from '@/lib/services/publication'
import { processMaintenance } from '@/lib/services/maintenance'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 独立机器Bearer鉴权，Cookie管理员会话不能调用维护任务。 */
export const GET = apiHandler(async (request) => {
  authorizePublicationJob(request)
  return ok(await processMaintenance())
})
