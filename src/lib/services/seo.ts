import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicContentScope } from './public-content'
import { getPublicSite, applyPublicPrivacy } from './public-site'
import { getPublicArticle } from './article'
import { getPublicLog } from './log'
import { getPublicProject } from './project'
import { rssXml, sitemapXml, type FeedEntry } from '@/lib/seo'
import { plainSearchText } from '@/lib/search-display'
import { ApiError } from '@/lib/api/errors'

/** 订阅只读取最近候选，正文只用于无摘要内容，最终排序稳定且上限50。 */
export async function publicRss() {
  const site = await getPublicSite()
  const entries = await prisma.$transaction(
    async (tx) => {
      const scope = await publicContentScope(tx)
      const [articles, logs] = await Promise.all([
        tx.article.findMany({
          where: scope.article,
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: 50,
          select: {
            id: true,
            slug: true,
            title: true,
            summary: true,
            content: true,
            publishedAt: true,
          },
        }),
        tx.log.findMany({
          where: scope.log,
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: 50,
          select: { id: true, title: true, summary: true, content: true, publishedAt: true },
        }),
      ])
      const route = (key: string) => scope.modules.find((m) => m.key === key)?.route ?? '/'
      const candidates = [
        ...articles.map((item) => ({
          ...item,
          resource: 'article' as const,
          path: route('article') + '/' + item.slug,
        })),
        ...logs.map((item) => ({
          ...item,
          resource: 'log' as const,
          path: route('log') + '/' + item.id,
        })),
      ]
        .sort(
          (a, b) =>
            b.publishedAt!.getTime() - a.publishedAt!.getTime() ||
            a.resource.localeCompare(b.resource) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 50)
      return applyPublicPrivacy(candidates, tx)
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
  const clean = entries
  const feed: FeedEntry[] = clean.map((item) => ({
    resource: item.resource,
    id: item.id,
    title: item.title,
    path: item.path,
    summary: plainSearchText(item.summary || item.content).slice(0, 300),
    publishedAt: item.publishedAt!,
  }))
  return rssXml(site.site, feed)
}

/** 地图只投影路径/修改时间，隐私正文和历史别名不进入索引。 */
export async function publicSitemap() {
  const site = await getPublicSite()
  const entries = await prisma.$transaction(
    async (tx) => {
      const scope = await publicContentScope(tx)
      const [articles, logs, projects, categories, tags] = await Promise.all([
        tx.article.findMany({ where: scope.article, select: { slug: true, updatedAt: true } }),
        tx.log.findMany({ where: scope.log, select: { id: true, updatedAt: true } }),
        tx.project.findMany({ where: scope.project, select: { slug: true, updatedAt: true } }),
        tx.category.findMany({
          where: {
            OR: [
              { articles: { some: scope.article } },
              { children: { some: { articles: { some: scope.article } } } },
            ],
          },
          select: { slug: true },
        }),
        tx.tag.findMany({ where: { articles: { some: scope.article } }, select: { slug: true } }),
      ])
      const route = (key: string) => scope.modules.find((m) => m.key === key)?.route ?? '/'
      return [
        ...categories.map((item) => ({ path: route('article') + '/category/' + item.slug })),
        ...tags.map((item) => ({ path: route('article') + '/tag/' + item.slug })),
        ...articles.map((item) => ({
          path: route('article') + '/' + item.slug,
          updatedAt: item.updatedAt,
        })),
        ...logs.map((item) => ({ path: route('log') + '/' + item.id, updatedAt: item.updatedAt })),
        ...projects.map((item) => ({
          path: route('portfolio') + '/' + item.slug,
          updatedAt: item.updatedAt,
        })),
      ]
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
  const paths = site.modules
    .filter((m) => ['home', 'article', 'log', 'portfolio', 'timeline', 'about'].includes(m.key))
    .map((m) => ({ path: m.route }))
  // 首页始终是系统路由；栏目home开关仅控制首页露出。
  if (!paths.some((item) => item.path === '/')) paths.unshift({ path: '/' })
  const unique = [...new Map([...paths, ...entries].map((item) => [item.path, item])).values()]
  // sitemap协议单文档上限，超过时明确失败，不能静默丢失已公开内容。
  if (unique.length > 50000) throw new ApiError(503, 'SITEMAP_LIMIT', '站点地图需要拆分索引')
  return sitemapXml(unique)
}

/** OG仅通过公开详情服务取标题；拒绝草稿、关闭栏目及任意远程图片抓取。 */
export async function publicOg(params: URLSearchParams) {
  const site = await getPublicSite()
  const resource = params.get('resource'),
    id = params.get('id')
  if (!resource && !id)
    return { title: site.site.name, subtitle: site.site.description, site: site.site.name }
  if (!id || !resource || !['article', 'log', 'project'].includes(resource) || id.length > 200)
    throw new ApiError(400, 'VALIDATION_ERROR', '分享图片参数无效')
  const item =
    resource === 'article'
      ? await getPublicArticle(id)
      : resource === 'log'
        ? await getPublicLog(id)
        : await getPublicProject(id)
  return { title: item.title, subtitle: site.site.description, site: site.site.name }
}
