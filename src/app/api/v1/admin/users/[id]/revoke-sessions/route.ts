import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { revokeUserSessions } from '@/lib/services/user'
type Context = { params: Promise<{ id: string }> }
export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  return apiHandler(async (req) => ok(await revokeUserSessions(id, await readJson(req), req)))(
    request,
  )
}
