// 在后台页面的侧边栏中插入「动效」导航项（位于「外观主题」之后）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const NEEDLE = '<a><span class="icon">🎨</span>外观主题</a>'
const INSERT = '\n      <a><span class="icon">✨</span>动效</a>'

let patched = 0, skipped = 0
for (const f of readdirSync(root).filter((n) => n.startsWith('admin-') && n.endsWith('.html'))) {
  const p = join(root, f)
  const src = readFileSync(p, 'utf8')

  // 已有「动效」导航项（例如 admin-motion.html 本身）则跳过
  if (/<span class="icon">✨<\/span>动效<\/a>/.test(src)) { skipped++; continue }
  if (!src.includes(NEEDLE)) { console.log(`  ⚠ 未找到锚点: ${f}`); skipped++; continue }

  writeFileSync(p, src.replace(NEEDLE, NEEDLE + INSERT), 'utf8')
  patched++
  console.log(`  ✓ ${f}`)
}
console.log(`\n已更新 ${patched} 个文件，跳过 ${skipped} 个`)
