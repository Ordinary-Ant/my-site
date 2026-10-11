import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { LogRevisionSchema } from '@/lib/validators/log'
import { restoreLog } from '@/lib/services/log'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return apiHandler(async (req) =>
    ok(await restoreLog(id, LogRevisionSchema.parse(await readJson(req)).revision, req)),
  )(request)
}
