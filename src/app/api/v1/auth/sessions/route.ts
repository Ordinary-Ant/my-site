import { apiHandler, ok } from '@/lib/api/http'
import { listSessions } from '@/lib/services/auth'
export const runtime = 'nodejs'
export const GET = apiHandler(async (request) => ok(await listSessions(request)))
