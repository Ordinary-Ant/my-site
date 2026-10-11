import { apiHandler, ok } from '@/lib/api/http'
import { getAdminStats } from '@/lib/services/stats'
export const GET = apiHandler(async (request) => ok(await getAdminStats(request)))
