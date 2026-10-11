import { ImageResponse } from 'next/og'
import { publicOg } from '@/lib/services/seo'
import { ApiError } from '@/lib/api/errors'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const data = await publicOg(new URL(request.url).searchParams)
    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          padding: 70,
          flexDirection: 'column',
          justifyContent: 'center',
          color: '#fafafa',
          background: 'linear-gradient(135deg,#18181b,#312e81)',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, marginBottom: 36 }}>
          {data.site.slice(0, 80)}
        </div>
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 700 }}>
          {data.title.slice(0, 80)}
        </div>
        <div style={{ display: 'flex', fontSize: 26, marginTop: 36, color: '#d4d4d8' }}>
          {data.subtitle.slice(0, 120)}
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      },
    )
  } catch (error) {
    if (error instanceof ApiError)
      return new Response(error.message, {
        status: error.status,
        headers: { 'Cache-Control': 'no-store' },
      })
    throw error
  }
}
