import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
export const VISITOR_TTL = 30 * 86400
const signature = (value: string, secret: string) =>
  createHmac('sha256', secret)
    .update('public-visitor\0' + value)
    .digest('base64url')
/** 仅签发匿名随机标识，凭证与登录令牌使用独立用途前缀。 */
export function issueVisitor(secret: string, now = Math.floor(Date.now() / 1000)) {
  const payload = [now, now + VISITOR_TTL, randomBytes(32).toString('base64url')].join('.')
  return payload + '.' + signature(payload, secret)
}
export function readVisitor(
  token: string | undefined,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (!token || token.length > 250) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [issued, expires, nonce, sig] = parts,
    iat = Number(issued),
    exp = Number(expires)
  if (
    !/^\d+$/.test(issued) ||
    !/^\d+$/.test(expires) ||
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    exp - iat !== VISITOR_TTL ||
    iat > now + 60 ||
    exp <= now ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce)
  )
    return null
  const expected = Buffer.from(signature(parts.slice(0, 3).join('.'), secret)),
    actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  return createHash('sha256')
    .update('public-visitor\0' + nonce)
    .digest('hex')
}
export function skipViewRequest(headers: Headers) {
  return (
    headers.get('dnt') === '1' ||
    headers.get('sec-gpc') === '1' ||
    /bot|spider|crawl|slurp|facebookexternalhit|preview|curl|wget|headless/i.test(
      headers.get('user-agent')?.slice(0, 512) ?? '',
    )
  )
}
