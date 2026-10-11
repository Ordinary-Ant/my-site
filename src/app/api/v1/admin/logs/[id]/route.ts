import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { LogRevisionSchema } from '@/lib/validators/log'
import { getAdminLog, updateLog, deleteLog } from '@/lib/services/log'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminLog(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateLog(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await deleteLog(id, LogRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
