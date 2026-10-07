import { apiHandler, ok } from '@/lib/api/http'
import { listSettings } from '@/lib/services/settings'
export const GET = apiHandler(async (req) => ok(await listSettings(req)))
