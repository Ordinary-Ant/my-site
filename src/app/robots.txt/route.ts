import { absolutePublicUrl } from '@/lib/seo'
export const dynamic = 'force-dynamic'
export function GET() {
  return new Response(
    'User-agent: *\nAllow: /\nAllow: /api/v1/og\n' +
      ['/admin', '/api', '/login', '/preview', '/search']
        .map((path) => 'Disallow: ' + path + '\n')
        .join('') +
      'Sitemap: ' +
      absolutePublicUrl('/sitemap.xml') +
      '\n',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}
