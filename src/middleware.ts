import { NextResponse, type NextRequest } from 'next/server'
import { isRoutePath } from '@/lib/module-routing'
import { contentSecurityPolicy } from '@/lib/csp'
export async function middleware(request: NextRequest) {
  // 覆盖客户端伪造的nonce/CSP，Next服务端与响应使用同一个每请求随机值。
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
  const csp = contentSecurityPolicy(nonce, {
    production: process.env.NODE_ENV === 'production',
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin,
    storageEndpoint: process.env.S3_ENDPOINT,
  })
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)
  const secure = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', csp)
    return response
  }
  const next = () => secure(NextResponse.next({ request: { headers } }))
  const path = request.nextUrl.pathname
  // 首页是不可改名或占用的保留路径，无需读取栏目与历史别名。
  if (path === '/') return next()
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (
      !request.cookies.has('at') &&
      !request.cookies.has('rt') &&
      !request.cookies.has('session_hint')
    ) {
      const login = new URL('/login', request.url)
      login.searchParams.set('next', path + request.nextUrl.search)
      return secure(NextResponse.redirect(login))
    }
  }
  if (
    ['/api', '/_next', '/preview', '/login', '/admin', '/uploads', '/search'].some(
      (p) => path === p || path.startsWith(`${p}/`),
    )
  )
    return next()
  // 使用基础AbortController，避免部分边缘运行时缺少较新的timeout静态方法。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  let phase = 'FETCH'
  try {
    // 固定配置的站点Origin阻止Host伪造将内部查询变成任意远端请求。
    const lookup = new URL(
      '/api/v1/route-redirect',
      process.env.NEXT_PUBLIC_SITE_URL ?? request.url,
    )
    lookup.searchParams.set('path', path)
    // EdgeOne Fetch只承诺string/Request输入，不依赖浏览器对URL对象的隐式转换。
    const response = await fetch(lookup.href, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    phase = `HTTP_${response.status}`
    if (!response.ok) throw new Error('路由查询失败')
    phase = 'JSON'
    const result = (await response.json()) as { target: unknown }
    phase = 'TARGET'
    if (result.target !== null) {
      if (!isRoutePath(result.target)) throw new Error('无效重定向目标')
      const url = request.nextUrl.clone()
      url.pathname = result.target
      return secure(NextResponse.redirect(url, 301))
    }
    return next()
  } catch (error) {
    // 仅记录固定分类，禁止输出URL、请求头和原始异常内容。
    console.error({
      code: 'ROUTE_LOOKUP_FAILED',
      phase,
      kind:
        error instanceof Error &&
        ['Error', 'TypeError', 'SyntaxError', 'AbortError'].includes(error.name)
          ? error.name
          : 'Unknown',
    })
    return secure(
      new NextResponse('栏目路径暂不可用', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Route-Failure': phase },
      }),
    )
  } finally {
    clearTimeout(timer)
  }
}
export const config = {
  // Next15中间件默认Edge；不设置页面专用的runtime='edge'字段。
  matcher: ['/((?!api(?:/|$)|_next(?:/|$)|favicon.ico$).*)'],
}
