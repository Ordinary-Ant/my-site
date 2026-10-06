import { PrismaClient } from '@prisma/client'
import { env } from './env'

/**
 * Prisma 单例
 *
 * Next.js 开发模式下模块会被热重载，不挂到 globalThis 会不断创建新连接
 * 直到打满数据库连接池。
 *
 * TODO(M1)：接入软删除扩展（$extends query），让 Article/Log/Project 的
 *           查询自动附加 deletedAt: null，delete 自动变成 update。
 *           见 docs/02-data-model.md §2.4
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
