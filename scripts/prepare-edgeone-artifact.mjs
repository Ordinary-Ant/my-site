import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** CLI的middleware在全局作用域，无法读取usercode中的平台fetch；按请求建立独立闭包。 */
export function bindMiddlewareFetch(code) {
  const startMarker = '// Next.js Middleware compiled for EdgeOne Pages Edge Function'
  const endMarker = '      function recreateRequest('
  const invocation =
    "const runMiddleware = typeof executeMiddleware !== 'undefined' ? executeMiddleware : async function() { return null; };"
  const start = code.indexOf(startMarker)
  const end = code.indexOf(endMarker, start)
  if (
    start < 0 ||
    end <= start ||
    code.includes('function createMiddlewareRuntime(') ||
    code.split(invocation).length !== 2
  )
    throw new Error('CLI中间件模板已变化或已适配，拒绝重复修改')
  const wrapped =
    code.slice(0, start) +
    'function createMiddlewareRuntime(fetch) {\n' +
    'const self = Object.create(globalThis);\n' +
    "Object.defineProperty(self, 'webpackChunk_N_E', {value: [], writable: true, configurable: true});\n" +
    // CLI会重放全局chunk，导致第二个请求复用第一个fetch闭包；入口与chunk一起隔离。
    code.slice(start, end).replace('globalThis._ENTRIES = _ENTRIES;', '') +
    '\nreturn executeMiddleware;\n}\n' +
    code.slice(end)
  return wrapped.replace(invocation, 'const runMiddleware = createMiddlewareRuntime(fetch);')
}

/** 只把公开站点和存储Origin留在边缘代码中，服务器密钥由平台运行时提供。 */
export function sanitizeEdgeEnvironment(code, config) {
  const site = new URL(config.NEXT_PUBLIC_SITE_URL)
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/')
    throw new Error('发布站点必须为无凭据HTTPS Origin')
  const publicEnv = { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: site.origin }
  if (config.S3_ENDPOINT) {
    const storage = new URL(config.S3_ENDPOINT)
    if (storage.protocol !== 'https:' || storage.username || storage.password)
      throw new Error('存储地址必须为无凭据HTTPS URL')
    publicEnv.S3_ENDPOINT = storage.href
  }
  let replacements = 0
  // CLI生成的env值为JSON对象；按字符串边界扫描，避免转义括号破坏替换范围。
  const matcher = /\benv:\s*(\{)/g
  let cursor = 0
  let output = ''
  while (matcher.exec(code)) {
    const start = matcher.lastIndex - 1
    let depth = 0,
      quoted = false,
      escaped = false,
      end = start
    for (; end < code.length; end++) {
      const ch = code[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') quoted = false
      } else if (ch === '"') quoted = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        end++
        break
      }
    }
    let parsed
    try {
      parsed = JSON.parse(code.slice(start, end))
    } catch {
      continue
    }
    if (!Object.hasOwn(parsed, 'JWT_SECRET') && !Object.hasOwn(parsed, 'NEXT_PUBLIC_SITE_URL'))
      continue
    output += code.slice(cursor, start) + JSON.stringify(publicEnv)
    cursor = end
    matcher.lastIndex = end
    replacements++
  }
  return { code: output + code.slice(cursor), replacements }
}

export function prepareEdgeOneArtifact(directory, config) {
  const root = path.resolve(directory)
  const compiled = path.join(root, '.next/functions/compiled-middleware.js')
  if (!fs.existsSync(compiled) || fs.statSync(compiled).size < 1000)
    throw new Error('中间件产物缺失或为空，拒绝发布')
  const index = path.join(root, '.edgeone/edge-functions/index.js')
  const original = fs.readFileSync(index, 'utf8')
  if (original.includes("'__MIDDLEWARE_BUNDLE_CODE__'"))
    throw new Error('中间件未注入边缘入口，拒绝发布')
  const result = sanitizeEdgeEnvironment(bindMiddlewareFetch(original), config)
  if (result.replacements !== 3) throw new Error('CLI环境注入结构已变化，需复审后再发布')
  fs.writeFileSync(index, result.code)
  return {
    middlewareBytes: fs.statSync(compiled).size,
    sanitizedEnvironmentObjects: result.replacements,
    requestScopedPlatformFetch: true,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(prepareEdgeOneArtifact(process.argv[2] ?? '.', process.env)))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
