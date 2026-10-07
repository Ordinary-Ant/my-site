import { apiHandler, ok } from '@/lib/api/http'
import { mediaReferences } from '@/lib/services/media'
export const runtime = 'nodejs'
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  apiHandler(async (request) => ok(await mediaReferences((await context.params).id, request)))(
    request,
  )
