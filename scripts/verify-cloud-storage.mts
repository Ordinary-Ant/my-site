/* eslint-disable no-console -- 本地验收只输出固定状态，不输出凭据或签名URL。 */
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import sharp from 'sharp'

// 仅在本地读取凭据；签名URL、响应正文及原始异常均不得写入日志。
const config = parseEnv(fs.readFileSync('.env.edgeone.local', 'utf8'))
Object.assign(process.env, config, {
  NODE_ENV: 'production',
  JWT_SECRET: config.JWT_SECRET || randomBytes(48).toString('base64url'),
  NEXT_PUBLIC_SITE_URL: config.NEXT_PUBLIC_SITE_URL || 'http://localhost:3100',
})
const { R2Driver } = await import('../src/lib/storage/drivers')
const { inspectMedia } = await import('../src/lib/storage/validation')
const driver = new R2Driver()
const privateKey = `private/upload/${randomUUID()}`
const publicKey = `media/${randomUUID()}.png`
const created: string[] = []
let stage = 'INIT'
const check = (value: boolean, code: string) => {
  if (!value) throw new Error(code)
  console.log(`${code}: PASS`)
}
try {
  const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#718096' } })
    .png()
    .toBuffer()
  const inspected = await inspectMedia(bytes, 'image/png')
  const intent = await driver.intent(privateKey, inspected.mimeType, bytes.length, inspected.hash)
  // 只删除本次UUID生成的探针，失败也尝试清理，不触碰既有媒体。
  created.push(privateKey)
  stage = 'SIGNED_UPLOAD'
  const uploaded = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(20000),
  })
  check(uploaded.ok, `SIGNED_UPLOAD_HTTP_${uploaded.status}`)
  stage = 'PRIVATE_DOWNLOAD'
  check((await driver.get(privateKey, 1024)).equals(bytes), 'PRIVATE_DOWNLOAD_HASH')
  const publicApiBase = config.S3_PUBLIC_BASE_URL!.replace(/\/[^/]+\/?$/, '')
  stage = 'PRIVATE_ANONYMOUS'
  const anonymous = await fetch(`${publicApiBase}/${config.S3_PRIVATE_BUCKET}/${privateKey}`, {
    signal: AbortSignal.timeout(15000),
  })
  check(!anonymous.ok, 'PRIVATE_ANONYMOUS_DENIED')
  stage = 'VALIDATE_AND_PUBLIC_WRITE'
  await inspectMedia(await driver.get(privateKey, 1024), 'image/png')
  created.push(publicKey)
  await driver.put(publicKey, bytes, 'image/png')
  stage = 'PUBLIC_DOWNLOAD'
  const publicResponse = await fetch(driver.publicUrl(publicKey), {
    signal: AbortSignal.timeout(15000),
  })
  check(
    publicResponse.ok && Buffer.from(await publicResponse.arrayBuffer()).equals(bytes),
    'PUBLIC_VALIDATED_OBJECT',
  )
  stage = 'PREFLIGHT'
  const cors = await fetch(intent.uploadUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3100',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,x-amz-checksum-sha256',
    },
    signal: AbortSignal.timeout(15000),
  })
  const origin = cors.headers.get('access-control-allow-origin')
  const headers = cors.headers.get('access-control-allow-headers')?.toLowerCase() || ''
  check(
    cors.ok &&
      (origin === '*' || origin === 'http://localhost:3100') &&
      headers.includes('x-amz-checksum-sha256'),
    'LOCAL_ORIGIN_PREFLIGHT',
  )
} catch (error) {
  // 只记录已知验证标记或异常类别，SDK原始错误可能含签名/凭据。
  console.error(
    'STORAGE_CHECK_FAILED',
    stage,
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : (error as Error).name,
  )
  const cause = (error as { cause?: { code?: string } }).cause?.code
  if (cause && /^[A-Z0-9_]+$/.test(cause)) console.error('NETWORK_CODE', cause)
  process.exitCode = 1
} finally {
  for (const key of created) {
    try {
      await driver.remove(key)
      console.log('PROBE_CLEANUP: PASS')
    } catch {
      console.error('PROBE_CLEANUP: FAILED')
      process.exitCode = 1
    }
  }
}
