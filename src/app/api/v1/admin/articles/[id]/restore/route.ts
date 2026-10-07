import { RevisionSchema } from '@/lib/validators/article'
import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { restoreArticle } from '@/lib/services/article'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    const body = RevisionSchema.parse(await readJson(req))
    return ok(await restoreArticle(id, body.revision, req))
  })(request)
}
