import { prisma } from '@/lib/prisma'
import { isRoutePath, resolveModuleRedirect } from '@/lib/module-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 边缘中间件仅取得公开301目标；数据库查询留在Node，不暴露内部记录。 */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const path = new URL(request.url).searchParams.get('path')
  if (!isRoutePath(path)) return Response.json({ error: 'INVALID_PATH' }, { status: 400, headers })
  try {
    const [modules, aliases] = await Promise.all([
      prisma.module.findMany({ select: { key: true, route: true } }),
      prisma.routeAlias.findMany({ select: { moduleKey: true, path: true } }),
    ])
    return Response.json({ target: resolveModuleRedirect(path, modules, aliases) }, { headers })
  } catch {
    return Response.json({ error: 'ROUTE_UNAVAILABLE' }, { status: 503, headers })
  }
}
