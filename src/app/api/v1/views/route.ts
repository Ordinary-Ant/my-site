import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { recordPublicView } from '@/lib/services/stats'
import { env } from '@/lib/env'
import { VISITOR_TTL } from '@/lib/visitor'
export const POST = apiHandler(async (request) => {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL)
  if (site.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))
    throw new Error('HTTPS_REQUIRED')
  const result = await recordPublicView(await readJson(request), request),
    response = ok(result.data)
  if (result.cookie)
    response.cookies.set('site_visitor', result.cookie, {
      httpOnly: true,
      secure: site.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: VISITOR_TTL,
    })
  return response
})
