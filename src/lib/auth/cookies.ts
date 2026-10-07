import 'server-only'
import type { NextResponse } from 'next/server'
import { env } from '../env'
import type { Credentials } from '../services/auth'
export function setAuthCookies(response: NextResponse, credentials?: Credentials) {
  const site = new URL(env.NEXT_PUBLIC_SITE_URL)
  if (site.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))
    throw new Error('HTTPS_REQUIRED')
  const secure = site.protocol === 'https:'
  response.cookies.set('at', credentials?.accessToken ?? '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: credentials ? 900 : 0,
  })
  response.cookies.set('rt', credentials?.refreshToken ?? '', {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: credentials ? 604800 : 0,
  })
  return response
}
