import { apiHandler, ok } from '@/lib/api/http'
import { cleanupUploadIntents } from '@/lib/services/media'
export const runtime = 'nodejs'
export const POST = apiHandler(async (request) => ok(await cleanupUploadIntents(request)))
