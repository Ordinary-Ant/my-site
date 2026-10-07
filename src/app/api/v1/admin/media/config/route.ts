import { apiHandler, ok } from '@/lib/api/http'
import { requirePermission } from '@/lib/services/auth'
import { env } from '@/lib/env'
/** 只公开上传方式，不把对象存储密钥或桶配置发送到浏览器。 */
export const GET = apiHandler(async (request) => {
  await requirePermission('content:read', request)
  return ok({ driver: env.STORAGE_DRIVER })
})
