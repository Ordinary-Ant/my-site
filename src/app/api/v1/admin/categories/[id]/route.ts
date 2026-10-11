import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { getAdminCategory, updateCategory, deleteCategory } from '@/lib/services/taxonomy'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminCategory(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateCategory(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await deleteCategory(id, await readJson(req), req)))(request)
}
