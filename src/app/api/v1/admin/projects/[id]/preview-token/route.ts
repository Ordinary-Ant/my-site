import { apiHandler, ok } from '@/lib/api/http'
import { createProjectPreviewToken } from '@/lib/services/project'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await createProjectPreviewToken(id, req)))(request)
}
