import { test, expect, vi } from 'vitest'
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' } }))
import { NextResponse } from 'next/server'
import { setAuthCookies } from '@/lib/auth/cookies'
test('刷新凭证附带非敏感提示，登出同出口清除提示cookie', () => {
  const response = NextResponse.json({})
  setAuthCookies(response, { accessToken: 'at-value', refreshToken: 'rt-value' } as Parameters<
    typeof setAuthCookies
  >[1])
  expect(response.cookies.get('session_hint')?.value).toBe('1')
  const hint = response.headers.get('set-cookie')!
  expect(hint).toContain('session_hint=1; Path=/;')
  expect(response.cookies.get('session_hint')).toMatchObject({
    path: '/',
    maxAge: 604800,
    httpOnly: true,
    sameSite: 'lax',
  })
  setAuthCookies(response)
  expect(response.cookies.get('session_hint')?.value).toBe('')
})
