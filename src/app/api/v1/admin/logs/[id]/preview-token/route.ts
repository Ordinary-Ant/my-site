import { apiHandler, ok } from '@/lib/api/http'
import { createLogPreviewToken } from '@/lib/services/log'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await createLogPreviewToken(id, req)))(request)
}
