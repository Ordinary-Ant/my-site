import { publicSitemap } from '@/lib/services/seo'
export const dynamic = 'force-dynamic'
export async function GET() {
  return new Response(await publicSitemap(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
