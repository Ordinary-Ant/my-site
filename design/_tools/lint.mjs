// 设计稿一致性 lint：未定义 class / 外部资源 / 占位文案 / 必需元素
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const cssPath = join(root, '_assets', 'mock.css')
const css = readFileSync(cssPath, 'utf8')

// ---- 收集 mock.css 中定义过的 class ----
const defined = new Set()
for (const m of css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) defined.add(m[1])

// 允许的例外：非 mock.css 定义但属于文档/HTML 语义或子代理合理使用的
const ALLOWED = new Set(['icon', 'sr-only'])

const files = readdirSync(root).filter((f) => f.endsWith('.html') && !f.startsWith('_') && f !== 'index.html')

const PLACEHOLDER_PATTERNS = [
  [/lorem ipsum/i, 'Lorem ipsum'],
  [/示例文本|示例文字|占位文本|待填写|待补充|TODO|FIXME|XXX/, '占位文案'],
  [/xxx+@|example\.com\s*$/m, '疑似假邮箱（example.com 可接受，仅提示）'],
]

const rows = []
const problems = []

for (const file of files) {
  const raw = readFileSync(join(root, file), 'utf8')
  const issues = []

  // 1. 未定义的 class
  const usedClasses = new Set()
  for (const m of raw.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) usedClasses.add(c)
  }
  const unknown = [...usedClasses].filter((c) => !defined.has(c) && !ALLOWED.has(c))

  // 2. 外部资源
  const externals = [...raw.matchAll(/(?:href|src)="((?:https?:)?\/\/[^"]+)"/g)].map((m) => m[1])

  // 3. <style> 块（仅允许含 data-tabbar 的响应式块）
  const styleBlocks = [...raw.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1])
  const badStyles = styleBlocks.filter((s) => !/data-tabbar/.test(s))

  // 4. 必需元素
  const hasCss = raw.includes('_assets/mock.css')
  const hasDark = /prefers-color-scheme/.test(raw)
  const hasSpec = /class="spec"/.test(raw)
  const hasViewport = /name="viewport"/.test(raw)
  const isLogin = /site-login/.test(file)
  const isDesignSystem = /design-system|motion-storyboard/.test(file)
  const hasHeader = /class="site-header"/.test(raw)
  const hasFooter = /class="site-footer"/.test(raw)
  const isAdmin = file.startsWith('admin-')
  const hasShell = /class="admin-shell"/.test(raw)
  const hasTabbar = /data-tabbar/.test(raw)

  if (unknown.length) issues.push(`未定义 class: ${unknown.join(', ')}`)
  if (externals.length) issues.push(`外部资源: ${externals.join(', ')}`)
  if (badStyles.length) issues.push(`非法的 <style> 块（${badStyles.length} 个，仅允许含 data-tabbar 的）`)
  if (!hasCss) issues.push('缺少 mock.css 引用')
  if (!hasDark) issues.push('缺少深色模式检测脚本')
  if (!hasSpec) issues.push('缺少 .spec 标注条')
  if (!hasViewport) issues.push('缺少 viewport meta')
  if (isAdmin && !hasShell) issues.push('后台页缺少 .admin-shell 骨架')
  if (!isAdmin && !isLogin && !isDesignSystem && !hasHeader) issues.push('前台页缺少 .site-header')
  if (!isAdmin && !isLogin && !isDesignSystem && !hasFooter) issues.push('前台页缺少 .site-footer')
  if (!isAdmin && !isLogin && !isDesignSystem && !hasTabbar) issues.push('前台页缺少移动端 tabbar')

  for (const [re, label] of PLACEHOLDER_PATTERNS) {
    if (re.test(raw) && !/example\.com/.test(label)) issues.push(label)
  }

  if (issues.length) problems.push(`${file}\n    - ${issues.join('\n    - ')}`)
  rows.push({
    file,
    KB: Math.round(Buffer.byteLength(raw) / 1024),
    classes: usedClasses.size,
    unknown: unknown.length,
    ext: externals.length,
    status: issues.length ? '⚠' : 'OK',
  })
}

console.table(rows)
console.log(
  problems.length
    ? `\n⚠ ${problems.length}/${files.length} 个文件有问题：\n\n${problems.join('\n\n')}`
    : `\n✅ 全部 ${files.length} 个设计稿通过一致性检查`
)

// 预期页面清单直接来自 manifest —— 单一数据源，避免两处各写一份对不上
const manifestPath = join(root, 'manifest-all.json')
let expected = []
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  expected = [...new Set(manifest.targets.map((t) => t.file))]
}
const missing = expected.filter((f) => !existsSync(join(root, f)))
console.log(
  missing.length
    ? `\n⏳ 尚未产出（manifest 里声明但文件不存在）：${missing.join(', ')}`
    : `\n✅ manifest 声明的 ${expected.length} 个源文件全部就位`,
)
const notInManifest = files.filter((f) => !expected.includes(f))
if (notInManifest.length) {
  console.log(`⚠ 存在但未在 manifest 里声明（不会被截图）：${notInManifest.join(', ')}`)
}
