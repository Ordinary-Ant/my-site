import { existsSync } from 'node:fs'
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}
/** 外部调度每日执行一次；不输出凭据、错误正文或数据库信息。 */
const secret = process.env.REVALIDATE_SECRET
if (!secret || secret.length < 32 || secret === process.env.JWT_SECRET) {
  console.error('维护任务需要独立的至少32位REVALIDATE_SECRET')
  process.exit(1)
}
try {
  const response = await fetch(
    new URL('/api/v1/jobs/maintenance', process.env.NEXT_PUBLIC_SITE_URL),
    {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(30000),
    },
  )
  if (!response.ok) {
    console.error('维护任务失败', response.status)
    process.exitCode = 1
  } else {
    console.log('维护任务完成')
  }
} catch {
  console.error('维护任务网络失败')
  process.exitCode = 1
}
