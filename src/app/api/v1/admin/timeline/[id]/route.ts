import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { TimelineRevisionSchema } from '@/lib/validators/timeline'
import { getAdminTimeline, updateTimeline, deleteTimeline } from '@/lib/services/timeline'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await getAdminTimeline(id, req)))(request)
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await updateTimeline(id, await readJson(req), req)))(request)
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await deleteTimeline(id, TimelineRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
