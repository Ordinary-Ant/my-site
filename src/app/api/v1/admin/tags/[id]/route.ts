import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { getAdminTag, updateTag, deleteTag } from '@/lib/services/taxonomy'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminTag(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateTag(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await deleteTag(id, await readJson(req), req)))(request)
}
