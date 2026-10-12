import { prisma } from '@/lib/prisma'
import packageInfo from '../../../../package.json'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 探针只暴露最小状态，不把数据库异常和连接信息返回公网。 */
export async function GET() {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`
        await tx.$queryRaw`SELECT 1`
      },
      { maxWait: 2000, timeout: 3000 },
    )
    return Response.json(
      { status: 'ok', version: packageInfo.version, database: 'up' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return Response.json(
      { status: 'degraded', version: packageInfo.version, database: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
