import 'server-only'
import { z } from 'zod'

/**
 * 环境变量校验
 * 见 docs/01-architecture.md §11
 *
 * 原则：启动即失败（fail fast），不要等到运行时才发现缺变量。
 *
 * ⚠ 本文件只能在服务端导入。'server-only' 会让客户端误引入变成构建错误，
 *   而不是静默把密钥打进 bundle。
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空。本地开发先跑 npm run db:up'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 位。生成方式：openssl rand -base64 48'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_PRIVATE_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  REVALIDATE_SECRET: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_ADMIN_NAME: z.string().optional(),
})

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url('NEXT_PUBLIC_SITE_URL 必须是合法 URL'),
  NEXT_PUBLIC_ANALYTICS_ID: z.string().optional(),
})

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  · ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

/** 客户端可见的环境变量（只有 NEXT_PUBLIC_ 前缀能进来） */
const clientParsed = clientSchema.safeParse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_ANALYTICS_ID: process.env.NEXT_PUBLIC_ANALYTICS_ID,
})

if (!clientParsed.success) {
  throw new Error(`❌ 客户端环境变量校验失败：\n${formatIssues(clientParsed.error)}`)
}

export const clientEnv = clientParsed.data

/** 服务端环境变量 */
const serverParsed = serverSchema.safeParse(process.env)

if (!serverParsed.success) {
  throw new Error(
    `❌ 服务端环境变量校验失败：\n${formatIssues(serverParsed.error)}\n\n` +
      `提示：复制 .env.example 为 .env.local 后填写。`,
  )
}

export const env = { ...serverParsed.data, ...clientParsed.data }

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'

/**
 * 校验 S3 配置是否完整
 *
 * 注意：这里不用 `asserts env is ...` 断言函数 —— TS 的断言签名只能作用于
 * **函数参数**，而 env 是模块级 const，写断言谓词会报 "Cannot find parameter 'env'"。
 * 改成普通校验函数，语义一样清晰。
 */
export function assertS3Configured(): void {
  if (env.STORAGE_DRIVER !== 's3') return

  const required = [
    'S3_ENDPOINT',
    'S3_BUCKET',
    'S3_PRIVATE_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ] as const
  const missing = required.filter((k) => !env[k])

  if (missing.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=s3 但缺少配置：${missing.join(', ')}。见 docs/01-architecture.md §8`,
    )
  }
}
