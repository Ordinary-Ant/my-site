import { apiHandler, ok } from '@/lib/api/http'
import { listAdminModules } from '@/lib/services/module'
export const GET = apiHandler(async (request) => ok(await listAdminModules(request)))
