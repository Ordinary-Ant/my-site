import { apiHandler, ok } from '@/lib/api/http'
import { listVisibleModules } from '@/lib/services/public-site'
export const GET = apiHandler(async () => ok(await listVisibleModules()))
