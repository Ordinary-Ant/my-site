import { apiHandler, ok } from '@/lib/api/http'
import { readJson } from '@/lib/api/body'
import { listSettings, updateSettings } from '@/lib/services/settings'
import { settingGroups } from '@/lib/validators/settings'
import { ApiError } from '@/lib/api/errors'
import { getAdminMotion } from '@/lib/services/motion'
export async function GET(request: Request, context: { params: Promise<{ group: string }> }) {
  const { group } = await context.params
  return apiHandler(async (req) => {
    if (group === 'motion') return ok(await getAdminMotion(req))
    const groups = await listSettings(req)
    if (!Object.hasOwn(settingGroups, group))
      throw new ApiError(400, 'VALIDATION_ERROR', '未知设置组')
    return ok(groups[group] ?? {})
  })(request)
}
export async function PATCH(request: Request, context: { params: Promise<{ group: string }> }) {
  const { group } = await context.params
  return apiHandler(async (req) => ok(await updateSettings(group, await readJson(req), req)))(
    request,
  )
}
