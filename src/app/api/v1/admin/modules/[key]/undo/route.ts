import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { undoModule } from '@/lib/services/module'
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params
  return apiHandler(async (req) => ok(await undoModule(key, await readJson(req), req)))(request)
}
