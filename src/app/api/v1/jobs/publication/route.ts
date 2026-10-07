import { apiHandler, ok } from '@/lib/api/http'
import { authorizePublicationJob, processDuePublications } from '@/lib/services/publication'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 兼容外部分钟调度的GET入口，只有独立Bearer机器密钥能够触发。 */
export const GET = apiHandler(async (request) => {
  authorizePublicationJob(request)
  return ok(await processDuePublications())
})
