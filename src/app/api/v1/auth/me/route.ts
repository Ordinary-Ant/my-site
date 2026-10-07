import { apiHandler, ok } from '@/lib/api/http'
import { getSessionUser } from '@/lib/services/auth'
export const runtime = 'nodejs'
export const GET = apiHandler(async (request) => ok(await getSessionUser(request)))
