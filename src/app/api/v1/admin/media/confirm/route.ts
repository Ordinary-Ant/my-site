import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { confirmMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => {
  const response = ok(await confirmMedia(await readJson(request), request))
  return new Response(response.body, { status: 201, headers: response.headers })
})
