import { apiHandler, ok } from '@/lib/api/http'
import { requirePermission } from '@/lib/services/auth'
import { prisma } from '@/lib/prisma'
/** 编辑选项在认证后读取，分类与标签管理由独立模块负责。 */
export const GET = apiHandler(async (request) => {
  await requirePermission('content:read', request)
  const [categories, tags] = await Promise.all([
    prisma.category.findMany({ orderBy: { order: 'asc' } }),
    prisma.tag.findMany({ orderBy: { name: 'asc' } }),
  ])
  return ok({ categories, tags })
})
