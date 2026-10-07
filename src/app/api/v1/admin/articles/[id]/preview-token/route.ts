import { apiHandler, ok } from '@/lib/api/http'
import { createPreviewToken } from '@/lib/services/article'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await createPreviewToken(id, req)))(request)
}
