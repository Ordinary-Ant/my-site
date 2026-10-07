/**
 * 离线静态验证器
 *
 * 在没有 node_modules 的情况下，尽可能多地提前发现构建期错误：
 *   A. import 路径解析   —— @/ 与相对路径是否指向真实存在的文件
 *   B. 依赖覆盖          —— 每个裸包名是否在 package.json 里声明
 *   C. 自定义 token 使用 —— TSX 里用的 bg-brand / text-fg-subtle 等是否在 @theme 里定义
 *   D. Prisma 关系完整性 —— 每个关系字段在对端是否有反向字段（Prisma 强校验）
 *   E. 类名清单          —— 列出全部用到的工具类，供人工过目
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { isBuiltin } from 'node:module'

const root = resolve(process.argv[2] ?? '.')
const srcDir = join(root, 'src')
const problems = []

// ---------------------------------------------------------------- 工具

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const allFiles = existsSync(srcDir) ? walk(srcDir) : []
const codeFiles = allFiles.filter((f) => ['.ts', '.tsx', '.css'].includes(extname(f)))

// ---------------------------------------------------------------- A. import 解析

const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.css', '.json', '/index.ts', '/index.tsx']

function resolveImport(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null // 裸包名，交给检查 B

  for (const ext of RESOLVE_EXT) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return false
}

const importRe = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g
const bareImports = new Set()
let importCount = 0

for (const file of codeFiles) {
  if (extname(file) === '.css') continue
  const text = readFileSync(file, 'utf8')
  const rel = file.slice(root.length + 1)
  let m
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1]
    importCount++
    const resolved = resolveImport(spec, file)
    if (resolved === false) {
      problems.push(`[A] ${rel}: 无法解析 import "${spec}"`)
    } else if (resolved === null) {
      // 裸包名：取包名（处理 @scope/name）
      const parts = spec.split('/')
      const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      bareImports.add(pkg)
    }
  }
}
console.log(
  `A. import 解析：${codeFiles.length} 个文件，${importCount} 条 import，无法解析 ${
    problems.filter((p) => p.startsWith('[A]')).length
  } 条`,
)

// ---------------------------------------------------------------- B. 依赖覆盖

const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = new Set([
  ...Object.keys(pkgJson.dependencies ?? {}),
  ...Object.keys(pkgJson.devDependencies ?? {}),
])
const NODE_BUILTINS = new Set([
  'node:fs',
  'node:path',
  'node:url',
  'node:process',
  'fs',
  'path',
  'url',
  'process',
  'node:crypto',
  'crypto',
  'node:os',
  'os',
  'node:child_process',
  'server-only', // 在 deps 里，这里重复保险
])
// 别名前缀（tsconfig paths）
const ALIAS_PREFIXES = ['@/']

const undeclared = [...bareImports].filter(
  (p) =>
    !declared.has(p) &&
    !isBuiltin(p) &&
    !NODE_BUILTINS.has(p) &&
    !ALIAS_PREFIXES.some((a) => p.startsWith(a)),
)
for (const p of undeclared) problems.push(`[B] 使用了未声明的依赖: ${p}`)
console.log(`B. 依赖覆盖：用到 ${bareImports.size} 个裸包，未声明 ${undeclared.length} 个`)

// ---------------------------------------------------------------- C. 自定义 token

const globalsCss = readFileSync(join(srcDir, 'app', 'globals.css'), 'utf8')
const definedTokens = new Set()
for (const m of globalsCss.matchAll(/--color-([a-z0-9-]+)\s*:/g)) definedTokens.add(m[1])
for (const m of globalsCss.matchAll(/--shadow-([a-z0-9-]+)\s*:/g)) definedTokens.add(m[1])

// 自定义命名特征：这些前缀一定来自我们的 @theme，若未定义即为错误
const CUSTOM_MARKERS = [
  'brand',
  'surface',
  'border-strong',
  'fg-subtle',
  'primary-foreground',
  'secondary-foreground',
  'muted-foreground',
  'card-foreground',
  'popover-foreground',
  'accent-foreground',
  'destructive-foreground',
  'type-work',
  'type-education',
  'type-project',
  'type-award',
  'type-milestone',
  'type-game',
  'type-repo',
  'type-skill',
  'type-other',
  'success',
  'warning',
  'info',
  'card-hover',
  'card',
  'pop',
]

const classRe = /class(?:Name)?=(?:"([^"]*)"|\{`([^`]*)`\})/g
const usedClasses = new Set()
for (const file of codeFiles.filter((f) => extname(f) === '.tsx')) {
  const text = readFileSync(file, 'utf8')
  let m
  while ((m = classRe.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ')
    for (const c of raw.split(/\s+/)) {
      if (!c || c.includes('$')) continue
      // 去掉变体前缀：hover: / md: / dark: / group-hover:
      const base = c.replace(/^((?:[a-z-]+:)+)/, '')
      usedClasses.add(base)
    }
  }
}

const badTokens = []
for (const c of usedClasses) {
  // 取出 "命名空间-后缀"，只关心颜色/阴影这类
  const m = c.match(
    /^(?:bg|text|border|from|to|via|ring|fill|stroke|outline|shadow|divide|decoration|accent|caret)-(.+)$/,
  )
  if (!m) continue
  // 剥离透明度后缀：bg-brand-soft/40 → brand-soft
  const suffix = m[1].split('/')[0]
  const looksCustom = CUSTOM_MARKERS.some((mk) => suffix === mk || suffix.startsWith(mk + '-'))
  if (looksCustom && !definedTokens.has(suffix)) badTokens.push(c)
}
for (const c of [...new Set(badTokens)]) problems.push(`[C] 使用了未定义的设计令牌: ${c}`)
console.log(
  `C. 自定义令牌：${definedTokens.size} 个已定义，${new Set(badTokens).size} 个类名找不到令牌`,
)

// ---------------------------------------------------------------- D. Prisma 关系

const schemaPath = join(root, 'prisma', 'schema.prisma')
if (existsSync(schemaPath)) {
  const lines = readFileSync(schemaPath, 'utf8').split(/\r?\n/)
  const models = new Map()
  let cur = null
  for (const line of lines) {
    const mm = line.match(/^model\s+(\w+)\s*\{/)
    if (mm) {
      cur = { name: mm[1], fields: [] }
      models.set(cur.name, cur)
      continue
    }
    if (/^\}/.test(line)) {
      cur = null
      continue
    }
    if (!cur) continue
    if (/^\s*(\/\/|@@)/.test(line)) continue
    const f = line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/)
    if (f) {
      cur.fields.push({
        name: f[1],
        type: f[2],
        isArray: Boolean(f[3]),
        isOptional: Boolean(f[4]),
        attrs: f[5] ?? '',
      })
    }
  }

  const relationIssues = []
  for (const model of models.values()) {
    for (const field of model.fields) {
      const target = models.get(field.type)
      if (!target) continue // 标量类型
      const back = target.fields.some((f) => f.type === model.name)
      if (!back) {
        relationIssues.push(
          `${model.name}.${field.name} → ${field.type}，但 ${field.type} 没有反向字段`,
        )
      }
    }
  }
  for (const i of relationIssues) problems.push(`[D] Prisma 关系缺失反向字段: ${i}`)

  const modelsWithMap = [...models.values()].filter((m) => m.fields.length === 0)
  console.log(
    `D. Prisma 关系：${models.size} 个 model，关系问题 ${relationIssues.length} 个，空 model ${modelsWithMap.length} 个`,
  )
} else {
  console.log('D. Prisma 关系：schema 不存在，跳过')
}

// ---------------------------------------------------------------- F. 环境变量覆盖

const envTs = readFileSync(join(srcDir, 'lib', 'env.ts'), 'utf8')
const envKeys = new Set()
for (const m of envTs.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gm)) envKeys.add(m[1])
// 格式化会把Zod链拆成多行；字段定义读到下个同级键或schema结束，不能只查首行。
const envDefinitions = new Map()
for (const match of envTs.matchAll(
  /^ {2}([A-Z][A-Z0-9_]*)\s*:([\s\S]*?)(?=^ {2}[A-Z][A-Z0-9_]*\s*:|^\}\))/gm,
)) {
  if (!envDefinitions.has(match[1])) envDefinitions.set(match[1], match[2])
}

const exampleTxt = existsSync(join(root, '.env.example'))
  ? readFileSync(join(root, '.env.example'), 'utf8')
  : ''
const exampleKeys = new Set()
for (const m of exampleTxt.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) exampleKeys.add(m[1])

// 本地环境文件：Next.js 两者都读，Prisma CLI 只读 .env。
// 本项目统一用 .env，但兼容 .env.local。
const localEnvPath = ['.env', '.env.local'].map((n) => join(root, n)).find((p) => existsSync(p))
const localTxt = localEnvPath ? readFileSync(localEnvPath, 'utf8') : ''
const localKeys = new Set()
for (const m of localTxt.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) localKeys.add(m[1])

const notDocumented = [...envKeys].filter((k) => !exampleKeys.has(k))
const notInLocal = [...envKeys].filter((k) => !localKeys.has(k) && !process.env[k])

for (const k of notDocumented) problems.push(`[F] ${k} 在 env.ts 里要求，但 .env.example 没写`)
for (const k of notInLocal) {
  // 只有带 .default() 或 .optional() 的才允许缺失
  const definition = envDefinitions.get(k) ?? ''
  const hasDefault = /\.default\(|\.optional\(/.test(definition)
  if (!hasDefault) problems.push(`[F] ${k} 是必填且没有默认值，本地环境文件里缺失 → 启动即崩`)
}
console.log(
  `F. 环境变量：env.ts 要求 ${envKeys.size} 个，.env.example 覆盖 ${envKeys.size - notDocumented.length} 个，` +
    `${localEnvPath ? localEnvPath.slice(root.length + 1) : '(无本地环境文件)'} 提供 ${envKeys.size - notInLocal.length} 个`,
)

// ---------------------------------------------------------------- E. 类名清单

console.log(`E. 共用到 ${usedClasses.size} 个工具类（见下）`)
console.log('   ' + [...usedClasses].sort().join('  '))

// ---------------------------------------------------------------- 汇总

console.log('\n' + '='.repeat(72))
if (problems.length === 0) {
  console.log('✅ 全部离线静态检查通过')
  console.log('='.repeat(72))
  process.exit(0)
} else {
  console.log(`❌ 发现 ${problems.length} 个问题：\n`)
  for (const p of problems) console.log('   ' + p)
  console.log('='.repeat(72))
  process.exit(1)
}
