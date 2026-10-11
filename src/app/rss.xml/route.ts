import { publicRss } from '@/lib/services/seo'
export const dynamic = 'force-dynamic'
export async function GET() {
  return new Response(await publicRss(), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
