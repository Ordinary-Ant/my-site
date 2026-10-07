import { apiHandler } from '@/lib/api/http'
import { readLocalMedia } from '@/lib/services/media'
export const runtime = 'nodejs'
export const GET = (request: Request, context: { params: Promise<{ id: string }> }) =>
  apiHandler(async () => {
    const { media, bytes } = await readLocalMedia((await context.params).id)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(media.size),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': media.kind === 'DOCUMENT' ? 'attachment' : 'inline',
      },
    })
  })(request)
