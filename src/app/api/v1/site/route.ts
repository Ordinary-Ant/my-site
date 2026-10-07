import { apiHandler, ok } from '@/lib/api/http'
import { getPublicSite } from '@/lib/services/public-site'
export const GET = apiHandler(async () => ok(await getPublicSite()))
