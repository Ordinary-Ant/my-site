import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { TimelineRevisionSchema } from '@/lib/validators/timeline'
import { restoreTimeline } from '@/lib/services/timeline'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    return ok(
      await restoreTimeline(id, TimelineRevisionSchema.parse(await readJson(req)).revision, req),
    )
  })(request)
}
