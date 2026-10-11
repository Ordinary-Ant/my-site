import { apiHandler, ok } from '@/lib/api/http'
import { exportData } from '@/lib/services/data'
export const runtime = 'nodejs'
export const GET = apiHandler(async (request) => {
  const response = ok(await exportData(request))
  response.headers.set(
    'Content-Disposition',
    `attachment; filename="personal-site-${new Date().toISOString().slice(0, 10)}.json"`,
  )
  return response
})
