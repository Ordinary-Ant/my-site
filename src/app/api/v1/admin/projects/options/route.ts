import { apiHandler, ok } from '@/lib/api/http'
import { getProjectOptions } from '@/lib/services/project'
export const GET = apiHandler(async (request) => ok(await getProjectOptions(request)))
