import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { getMedia, updateMedia, deleteMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }
export const GET = (request: Request, context: Context) =>
  apiHandler(async (request) => ok(await getMedia((await context.params).id, request)))(request)
export const PATCH = (request: Request, context: Context) =>
  apiHandler(async (request) =>
    ok(await updateMedia((await context.params).id, await readJson(request), request)),
  )(request)
export const DELETE = (request: Request, context: Context) =>
  apiHandler(async (request) => ok(await deleteMedia((await context.params).id, request)))(request)
