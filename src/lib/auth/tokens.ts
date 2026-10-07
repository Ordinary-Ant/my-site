import 'server-only'
import { createHash, randomBytes, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '../env'
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newRefreshToken = () => randomBytes(32).toString('base64url')
export async function signAccessToken(
  user: { id: string; role: string; name: string },
  sid: string,
) {
  return new SignJWT({ sid, role: user.role, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(env.JWT_SECRET))
}
export async function verifyAccessToken(token: string) {
  return (
    await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { algorithms: ['HS256'] })
  ).payload
}
const key = Buffer.from(
  hkdfSync(
    'sha256',
    Buffer.from(env.JWT_SECRET),
    Buffer.from('personal-site-session'),
    Buffer.from('refresh-rotation-reply-v1'),
    32,
  ),
)
export function encryptReply(value: unknown) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url')
}
export function decryptReply<T>(value: string): T {
  const bytes = Buffer.from(value, 'base64url')
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
  ) as T
}
