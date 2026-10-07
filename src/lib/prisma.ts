import { PrismaClient } from '@prisma/client'
import { env } from './env'

/**
 * Prisma 单例
 *
 * Next.js 开发模式下模块会被热重载，不挂到 globalThis 会不断创建新连接
 * 直到打满数据库连接池。
 *
 * 公开过滤、软删除和恢复由服务层显式执行；后台回收站需要读取删除记录，
 * 因此不在全局查询扩展中隐式改变条件。见 docs/02-data-model.md §2.4。
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 生产错误由API包装器仅记录错误码/requestId，避免SQL参数进入原始日志。
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
