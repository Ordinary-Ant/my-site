import { readJson } from '@/lib/api/body'
import { apiHandler, ok } from '@/lib/api/http'
import { getAdminProfile, updateProfile } from '@/lib/services/profile'
export const GET = apiHandler(async (request) => ok(await getAdminProfile(request)))
export const PATCH = apiHandler(async (request) =>
  ok(await updateProfile(await readJson(request), request)),
)
