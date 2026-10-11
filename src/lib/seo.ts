import { siteConfig } from '@/config/site'

/** SEO链接始终由本站路径生成，拒绝协议相对地址和外部Origin。 */
export function absolutePublicUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    throw new Error('SEO地址必须为本站绝对路径')
  return new URL(path, siteConfig.url).href
}
export function xmlText(value: string) {
  return value
    .replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[char]!,
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}
/** script文本上下文不能只依赖HTML属性转义。 */
export function jsonLdText(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  )
}
export type FeedEntry = {
  resource: 'article' | 'log'
  id: string
  title: string
  summary: string
  path: string
  publishedAt: Date
}
export function rssXml(site: { name: string; description: string }, entries: FeedEntry[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
    `<title>${xmlText(site.name)}</title><link>${xmlText(absolutePublicUrl('/'))}</link>` +
    `<description>${xmlText(site.description)}</description><language>zh-CN</language>` +
    `<atom:link href="${xmlText(absolutePublicUrl('/rss.xml'))}" rel="self" type="application/rss+xml"/>` +
    entries
      .map(
        (item) =>
          `<item><title>${xmlText(item.title)}</title>` +
          `<link>${xmlText(absolutePublicUrl(item.path))}</link>` +
          `<guid isPermaLink="false">${xmlText(item.resource + ':' + item.id)}</guid>` +
          `<pubDate>${item.publishedAt.toUTCString()}</pubDate>` +
          `<description>${xmlText(item.summary)}</description></item>`,
      )
      .join('') +
    '</channel></rss>'
  )
}
export function sitemapXml(entries: { path: string; updatedAt?: Date }[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    entries
      .map(
        (item) =>
          `<url><loc>${xmlText(absolutePublicUrl(item.path))}</loc>` +
          (item.updatedAt ? `<lastmod>${item.updatedAt.toISOString()}</lastmod>` : '') +
          '</url>',
      )
      .join('') +
    '</urlset>'
  )
}
