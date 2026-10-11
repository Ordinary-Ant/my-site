import { apiHandler, ok } from '@/lib/api/http'
import { getLogCalendar } from '@/lib/services/log'
export const GET = apiHandler(async (request) =>
  ok(await getLogCalendar(new URL(request.url).searchParams)),
)
