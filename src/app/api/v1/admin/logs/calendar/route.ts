import { apiHandler, ok } from '@/lib/api/http'
import { listAdminLogCalendar } from '@/lib/services/log'
export const GET = apiHandler(async (request) =>
  ok(await listAdminLogCalendar(new URL(request.url).searchParams, request)),
)
