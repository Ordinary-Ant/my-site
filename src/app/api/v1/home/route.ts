import { apiHandler, ok } from '@/lib/api/http'
import { getHomeFeed } from '@/lib/services/public-site'
export const GET = apiHandler(async () => ok(await getHomeFeed()))
