import { apiHandler, ok } from '@/lib/api/http'
import { refresh, assertOrigin, requestInfo, readCookie } from '@/lib/services/auth'
import { setAuthCookies } from '@/lib/auth/cookies'
import { ApiError } from '@/lib/api/errors'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  await assertOrigin(request)
  const token = readCookie(request, 'rt')
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', '请重新登录')
  const credentials = await refresh(token, requestInfo(request), request)
  return setAuthCookies(ok({ user: credentials.user, expiresIn: 900 }), credentials)
})
