import { z } from 'zod'
import { apiHandler, ok, parseBody } from '@/lib/api/http'
import { changePassword, assertOrigin } from '@/lib/services/auth'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  await assertOrigin(request)
  const body = await parseBody(
    request,
    z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(8).max(128),
      })
      .strict(),
  )
  await changePassword(body.currentPassword, body.newPassword, request)
  return ok(null)
})
