import { z } from 'zod'
import { apiHandler, ok, parseBody } from '@/lib/api/http'
import { login, assertOrigin, requestInfo } from '@/lib/services/auth'
import { setAuthCookies } from '@/lib/auth/cookies'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  await assertOrigin(request)
  const body = await parseBody(
    request,
    z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict(),
  )
  const credentials = await login(body.email, body.password, requestInfo(request), request)
  return setAuthCookies(
    ok({ user: credentials.user, expiresIn: credentials.expiresIn }),
    credentials,
  )
})
