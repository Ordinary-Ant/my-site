import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import postcss from 'postcss'
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

// 动效跨前台与预览拆包，跟踪实际生成的动态依赖，不能只计小型入口。
const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
  )
const chunks = walk('.next/static/chunks').filter((file) => file.endsWith('.js'))
const sources = new Map(chunks.map((file) => [file, readFileSync(file, 'utf8')]))
const dependencies = new Map(
  chunks.flatMap((file) => {
    const id = file
      .split(/[\\/]/)
      .at(-1)
      .match(/^(\d+)[.-]/)?.[1]
    return id ? [[id, file]] : []
  }),
)
const selected = new Set(
  chunks.filter((file) => /motionEngine|site-motion-preference/.test(sources.get(file))),
)
if (!selected.size) throw new Error('构建缺少动效运行时，不能声明预算通过')
for (const file of selected) {
  for (const match of sources.get(file).matchAll(/\.e\((\d+)\)/g)) {
    const dependency = dependencies.get(match[1])
    if (!dependency) throw new Error('缺少动态依赖chunk: ' + match[1])
    selected.add(dependency)
  }
}
const motionFiles = [...selected].map((file) => ({
  file: file.replaceAll('\\', '/').replace(/^\.next\//, ''),
  role: /site-motion-preference/.test(sources.get(file)) ? 'runtime' : 'engine',
  gzipBytes: gzipSync(readFileSync(file)).length,
}))
// 从真实生产CSS提取动效及降级规则，包含必要媒体查询父级。
function motionCss(node) {
  if (node.type === 'rule')
    return /site-motion|motion-card|motion-preferences|\.reveal/.test(node.selector)
      ? node.clone()
      : null
  if (
    node.type === 'atrule' &&
    ((node.name.includes('keyframes') && node.params === 'hero-enter') ||
      /prefers-reduced-motion:\s*reduce|scripting:\s*none/.test(node.params))
  )
    return node.clone()
  if (!node.nodes) return null
  const children = node.nodes.map(motionCss).filter(Boolean)
  if (!children.length) return null
  return node.clone({ nodes: children })
}
const fallbackCss = walk('.next/static/css')
  .filter((file) => file.endsWith('.css'))
  .map((file) => {
    const root = postcss.parse(readFileSync(file, 'utf8'))
    return root.nodes
      .map(motionCss)
      .filter(Boolean)
      .map((node) => node.toString())
      .join('')
  })
  .join('')
const fallbackGzipBytes = gzipSync(fallbackCss).length
const motionTotal = motionFiles.reduce((sum, item) => sum + item.gzipBytes, fallbackGzipBytes)
const motion = {
  page: 'motion',
  gzipBytes: motionTotal,
  gzipKB: Number((motionTotal / 1000).toFixed(2)),
  budgetKB: 28,
  passed: motionTotal <= 28000,
  fallbackGzipBytes,
  files: motionFiles,
}
console.log(JSON.stringify(motion, null, 2))
mkdirSync('docs/verification', { recursive: true })
writeFileSync('docs/verification/motion-budget.json', JSON.stringify(motion, null, 2) + '\n')
if (!motion.passed) process.exitCode = 1
