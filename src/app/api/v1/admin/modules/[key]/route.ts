import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { updateModule } from '@/lib/services/module'
export async function PATCH(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  return apiHandler(async (req) => ok(await updateModule(key, await readJson(req), req)))(request)
}
