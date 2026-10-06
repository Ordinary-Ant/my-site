import { existsSync } from 'node:fs'

import { defineConfig } from 'prisma/config'

/**
 * Prisma 配置
 *
 * 之前把 seed 命令写在 package.json 的 "prisma" 字段里，Prisma 6 起已弃用
 * （Prisma 7 会移除），这里迁移到官方推荐的配置文件。
 *
 * ⚠ 关键坑：一旦存在 prisma.config.ts，Prisma 就**不再自动加载 .env**
 *   （日志里会打印 "Prisma config detected, skipping environment variable loading"），
 *   表现为 schema 里 env("DATABASE_URL") 报 P1012 "Environment variable not found"。
 *   所以必须在下面手动加载。这里用 Node 内置的 process.loadEnvFile（Node >= 20.12），
 *   不引入 dotenv 依赖。
 *
 * 本文件由 Prisma CLI 加载，不参与 Next.js 构建。
 */

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
