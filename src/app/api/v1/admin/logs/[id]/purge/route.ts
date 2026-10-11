import { readJson } from '@/lib/api/body'
import { apiHandler } from '@/lib/api/http'
import { LogRevisionSchema } from '@/lib/validators/log'
import { purgeLog } from '@/lib/services/log'
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) => {
    await purgeLog(id, LogRevisionSchema.parse(await readJson(req)).revision, req)
    return new Response(null, { status: 204 })
  })(request)
}
