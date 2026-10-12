import { jsonLdText } from '@/lib/seo'
import { headers } from 'next/headers'
/** 只接收服务层已清洗的公开数据，序列化时阻断script闭合。 */
export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdText(data) }}
    />
  )
}
