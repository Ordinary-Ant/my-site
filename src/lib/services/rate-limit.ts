import 'server-only'
import { prisma } from '../prisma'
import { ApiError } from '../api/errors'
/** PG原子固定窗口计数，所有进程共享同一额度。 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
 INSERT INTO rate_limits (key,count,"expiresAt") VALUES (${key},1,NOW()+${windowMs} * INTERVAL '1 millisecond')
 ON CONFLICT (key) DO UPDATE SET count=CASE WHEN rate_limits."expiresAt"<=NOW() THEN 1 ELSE rate_limits.count+1 END,
 "expiresAt"=CASE WHEN rate_limits."expiresAt"<=NOW() THEN NOW()+${windowMs} * INTERVAL '1 millisecond' ELSE rate_limits."expiresAt" END RETURNING count,"expiresAt"`
  const row = rows[0]
  const retryAfter = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000))
  if (row.count > limit)
    throw new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试', undefined, {
      'Retry-After': String(retryAfter),
    })
  return { remaining: Math.max(0, limit - row.count), resetAt: row.expiresAt }
}
