import { existsSync } from 'node:fs'
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}
if (!process.env.REVALIDATE_SECRET || process.env.REVALIDATE_SECRET.length < 32)
  throw new Error('请在本地环境配置至少32位REVALIDATE_SECRET')
const url = new URL('/api/v1/jobs/publication', process.env.NEXT_PUBLIC_SITE_URL)
/** 本地每分钟发起一次受鉴权任务，日志只保留状态与计数。 */
async function run() {
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.REVALIDATE_SECRET}` },
    })
    if (!response.ok) console.error('发布调度失败', response.status)
    else {
      const { data } = await response.json()
      console.log('发布调度完成', data)
    }
  } catch {
    console.error('发布调度网络失败')
  }
}
await run()
setInterval(() => {
  void run()
}, 60000)
