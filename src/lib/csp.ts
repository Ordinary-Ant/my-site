/** 策略只接受服务端生成的nonce和经解析的存储origin，避免响应头注入。 */
export function contentSecurityPolicy(
  nonce: string,
  options: { production: boolean; siteUrl: string; storageEndpoint?: string },
) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error('无效CSP nonce')
  let storage = ''
  try {
    const url = new URL(options.storageEndpoint ?? '')
    if (url.protocol === 'https:' && !url.username && !url.password) storage = ' ' + url.origin
  } catch {
    /* 未配置远端存储时只连接同源。 */
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${storage}${options.production ? '' : ' ws: wss:'}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.production && new URL(options.siteUrl).protocol === 'https:'
      ? ['upgrade-insecure-requests']
      : []),
  ].join('; ')
}
