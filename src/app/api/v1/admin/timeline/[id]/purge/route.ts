import { readJson } from '@/lib/api/body'
import { apiHandler } from '@/lib/api/http'
import { TimelineRevisionSchema } from '@/lib/validators/timeline'
import { purgeTimeline } from '@/lib/services/timeline'
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await purgeTimeline(id, TimelineRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
