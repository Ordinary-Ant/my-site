import 'server-only'
import { revalidateTag } from 'next/cache'

/** 所有写服务通过同一依赖表失效，覆盖首页、订阅及SEO等派生出口。 */
export function invalidateContent(resource: string) {
  for (const tag of [resource, 'content', 'home', 'search', 'rss', 'sitemap', 'stats'])
    revalidateTag(tag)
}

export function invalidateConfiguration() {
  for (const tag of ['setting', 'module', 'content', 'home', 'search', 'rss', 'sitemap'])
    revalidateTag(tag)
}
