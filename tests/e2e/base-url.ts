import { existsSync } from 'node:fs'
// 配置进程与测试worker必须先加载相同环境，再解析地址；显式进程变量优先。
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file)
    break
  }
}
/** 本地端口可能被Windows保留；测试服务、Origin及独立上下文必须使用同一地址。 */
const address = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000')
if (
  address.protocol !== 'http:' ||
  address.hostname !== 'localhost' ||
  address.pathname !== '/' ||
  address.search ||
  address.hash ||
  address.username ||
  address.password
)
  throw new Error('E2E_BASE_URL只允许无路径的http://localhost本机地址')
export const testBaseURL = address.origin
