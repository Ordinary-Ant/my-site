import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveModuleRedirect } from '@/lib/module-routing'
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (
      !request.cookies.has('at') &&
      !request.cookies.has('rt') &&
      !request.cookies.has('session_hint')
    ) {
      const login = new URL('/login', request.url)
      login.searchParams.set('next', path + request.nextUrl.search)
      return NextResponse.redirect(login)
    }
  }
  if (
    ['/api', '/_next', '/preview', '/login', '/admin', '/uploads', '/search'].some(
      (p) => path === p || path.startsWith(`${p}/`),
    )
  )
    return NextResponse.next()
  const [modules, aliases] = await Promise.all([
    prisma.module.findMany({ select: { key: true, route: true } }),
    prisma.routeAlias.findMany({ select: { moduleKey: true, path: true } }),
  ])
  const target = resolveModuleRedirect(path, modules, aliases)
  if (target) {
    const url = request.nextUrl.clone()
    url.pathname = target
    return NextResponse.redirect(url, 301)
  }
  return NextResponse.next()
}
export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|favicon.ico$|preview(?:/|$)).*)'],
}
