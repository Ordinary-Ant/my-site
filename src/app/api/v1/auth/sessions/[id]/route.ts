import { apiHandler, ok } from '@/lib/api/http'
import { revokeSession, assertOrigin } from '@/lib/services/auth'
export const runtime = 'nodejs'
export const DELETE = apiHandler(async (request) => {
  await assertOrigin(request)
  const id = new URL(request.url).pathname.split('/').pop()!
  await revokeSession(id, request)
  return ok(null)
})
