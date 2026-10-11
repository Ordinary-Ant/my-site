import { apiHandler, ok } from '@/lib/api/http'
import { getPublicProfile } from '@/lib/services/profile'
export const GET = apiHandler(async (request) =>
  ok(await getPublicProfile(new URL(request.url).searchParams)),
)
