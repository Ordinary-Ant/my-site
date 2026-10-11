import { jsonLdText } from '@/lib/seo'
/** 只接收服务层已清洗的公开数据，序列化时阻断script闭合。 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />
  )
}
