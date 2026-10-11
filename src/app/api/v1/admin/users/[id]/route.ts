import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { getAdminUser, updateUser } from '@/lib/services/user'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminUser(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateUser(id, await readJson(req), req)))(request)
}
