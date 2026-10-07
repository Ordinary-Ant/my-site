import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
const manifest = JSON.parse(readFileSync('.next/app-build-manifest.json', 'utf8')).pages
/** 根据生产manifest合并页面/父布局/错误边界的真实JS文件并gzip去重计量。 */
for (const [name, routes, budget] of [
  ['login', ['/layout', '/error', '/not-found', '/login/page'], 110],
  ['article', ['/layout', '/error', '/not-found', '/(site)/layout', '/(site)/[...path]/page'], 135],
]) {
  const files = [
    ...new Set(
      routes.flatMap((route) => {
        if (!manifest[route]) throw new Error(`构建缺少${route}`)
        return manifest[route]
      }),
    ),
  ].filter((file) => file.endsWith('.js'))
  const measurements = files.map((file) => ({
    file,
    gzipBytes: gzipSync(readFileSync(join('.next', file))).length,
  }))
  const total = measurements.reduce((sum, item) => sum + item.gzipBytes, 0)
  console.log(
    JSON.stringify(
      {
        page: name,
        gzipBytes: total,
        gzipKB: Number((total / 1000).toFixed(2)),
        budgetKB: budget,
        passed: total <= budget * 1000,
        files: measurements,
      },
      null,
      2,
    ),
  )
  if (total > budget * 1000) process.exitCode = 1
}
