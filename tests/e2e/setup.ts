import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
/** 仅独立测试库初始化演示数据和限流窗口，绝不重置开发库。 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('拒绝操作非测试库')
  const seed = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  if (seed.status !== 0) throw new Error('E2E测试库seed失败')
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    await db.rateLimit.deleteMany({
      where: { OR: [{ key: 'login:ip:unknown' }, { key: 'login:email:admin@example.com' }] },
    })
  } finally {
    await db.$disconnect()
  }
}
