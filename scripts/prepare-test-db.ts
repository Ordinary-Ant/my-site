import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

/** 创建隔离测试库、部署迁移并初始化测试基线，不重置开发库。 */
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}
const source = process.env.DATABASE_URL
if (!source) throw new Error('缺少 DATABASE_URL')
const target = new URL(process.env.TEST_DATABASE_URL ?? source)
if (!process.env.TEST_DATABASE_URL) target.pathname = '/personal_site_test'
const database = target.pathname.slice(1)
if (!/^[a-z0-9_]+_test$/.test(database)) throw new Error('拒绝操作非测试库')
const adminUrl = new URL(target)
adminUrl.pathname = '/postgres'
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } })
try {
  const found = await admin.$queryRaw<
    { datname: string }[]
  >`SELECT datname FROM pg_database WHERE datname = ${database}`
  if (!found.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
} finally {
  await admin.$disconnect()
}
const cli = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { stdio: 'inherit', env: { ...process.env, DATABASE_URL: target.toString() } },
)
if (cli.status !== 0) process.exit(cli.status ?? 1)
// 集成测试依赖栏目、设置和Profile；仅迁移的空库不能代表可用测试环境。
const seed = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'seed'], {
  stdio: 'pipe',
  env: { ...process.env, DATABASE_URL: target.toString() },
})
if (seed.status !== 0) {
  console.error('独立测试库种子初始化失败；未输出账户或连接信息。')
  process.exit(seed.status ?? 1)
}
console.log('独立测试库迁移和种子完成；运行集成测试前设置 TEST_DATABASE_URL。')
