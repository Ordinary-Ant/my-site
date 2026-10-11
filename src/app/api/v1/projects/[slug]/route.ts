import { apiHandler, ok } from '@/lib/api/http'
import { getPublicProject } from '@/lib/services/project'
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  return apiHandler(async () => ok(await getPublicProject(slug)))(request)
}
