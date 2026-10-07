import { RevisionSchema } from '@/lib/validators/article'
import { readJson } from '@/lib/api/body'
import { apiHandler } from '@/lib/api/http'
import { purgeArticle } from '@/lib/services/article'
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    const body = RevisionSchema.parse(await readJson(req))
    await purgeArticle(id, body.revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
