import { apiHandler, ok } from '@/lib/api/http'
import { logout, assertOrigin } from '@/lib/services/auth'
import { setAuthCookies } from '@/lib/auth/cookies'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  await assertOrigin(request)
  await logout(request)
  return setAuthCookies(ok(null))
})
