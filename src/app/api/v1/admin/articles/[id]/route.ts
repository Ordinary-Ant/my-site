import { RevisionSchema } from '@/lib/validators/article'
import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { deleteArticle, getAdminArticle, updateArticle } from '@/lib/services/article'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminArticle(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateArticle(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    const body = RevisionSchema.parse(await readJson(req))
    await deleteArticle(id, body.revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
