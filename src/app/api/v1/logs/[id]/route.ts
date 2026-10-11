import { apiHandler, ok } from '@/lib/api/http'
import { getPublicLog } from '@/lib/services/log'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async () => ok(await getPublicLog(id)))(request)
}
