import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicContentScope } from './public-content'
import { applyPublicPrivacy } from './public-site'
import { parseSearchParams } from '@/lib/validators/search'
import { highlightedExcerpt } from '@/lib/search-display'
import { ApiError } from '@/lib/api/errors'

type Resource = 'article' | 'log' | 'project'
type Match = { type: Resource; id: string; publishedAt: Date }
export type SearchItem = Match & { title: string; excerpt: string; url: string }
const pagination = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
  hasNext: page * pageSize < total,
  hasPrev: page > 1,
})

/** 参数化UNION先跨表排序分页，避免各表截断导致后续页和总数错误。 */
export async function searchPublicContent(params: URLSearchParams) {
  const query = parseSearchParams(params),
    empty = { article: 0, log: 0, project: 0 }
  if (query.q.length < 2)
    return {
      data: [] as SearchItem[],
      meta: { ...pagination(query.page, query.pageSize, 0), query: query.q, typeCounts: empty },
    }
  return prisma.$transaction(
    async (tx) => {
      const scope = await publicContentScope(tx),
        now = new Date()
      const pattern = '%' + query.q.replace(/[\\%_]/g, (char) => '\\' + char) + '%'
      const enabled = (key: string) => scope.modules.some((m) => m.key === key && m.enabled)
      const logs = scope.log.type.in,
        projects = scope.project.type.in
      const today = new Date(
        new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z',
      )
      const union = Prisma.sql`
      SELECT 'article'::text AS type,id,"publishedAt" FROM articles
      WHERE ${enabled('article')} AND status='PUBLISHED' AND "deletedAt" IS NULL AND "publishedAt"<=${now}
      AND (title ILIKE ${pattern} OR COALESCE(summary,'') ILIKE ${pattern} OR content ILIKE ${pattern})
      UNION ALL
      SELECT 'log'::text AS type,id,"publishedAt" FROM logs
      WHERE ${enabled('log')} AND status='PUBLISHED' AND "deletedAt" IS NULL AND "publishedAt"<=${now}
      AND type::text = ANY(${logs}::text[]) AND ("logDate"<=${today} OR "isPinned")
      AND (title ILIKE ${pattern} OR COALESCE(summary,'') ILIKE ${pattern} OR content ILIKE ${pattern})
      UNION ALL
      SELECT 'project'::text AS type,id,"publishedAt" FROM projects
      WHERE ${enabled('portfolio')} AND status='PUBLISHED' AND "deletedAt" IS NULL AND "publishedAt"<=${now}
      AND type::text = ANY(${projects}::text[])
      AND (title ILIKE ${pattern} OR description ILIKE ${pattern} OR COALESCE(content,'') ILIKE ${pattern})`
      const counts = await tx.$queryRaw<{ type: Resource; count: number }[]>(
        Prisma.sql`SELECT type,COUNT(*)::int AS count FROM (${union}) c GROUP BY type`,
      )
      const typeCounts = { ...empty }
      for (const row of counts) typeCounts[row.type] = row.count
      const total =
        query.type === 'all'
          ? counts.reduce((sum, row) => sum + row.count, 0)
          : typeCounts[query.type]
      const filter = query.type === 'all' ? Prisma.sql`TRUE` : Prisma.sql`type=${query.type}`
      const matches = await tx.$queryRaw<Match[]>(
        Prisma.sql`SELECT * FROM (${union}) c WHERE ${filter} ORDER BY "publishedAt" DESC,type ASC,id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      )
      const ids = (type: Resource) => matches.filter((m) => m.type === type).map((m) => m.id)
      const [articles, logsData, projectsData] = await Promise.all([
        tx.article.findMany({
          where: { id: { in: ids('article') } },
          select: { id: true, slug: true, title: true, summary: true, content: true },
        }),
        tx.log.findMany({
          where: { id: { in: ids('log') } },
          select: { id: true, title: true, summary: true, content: true },
        }),
        tx.project.findMany({
          where: { id: { in: ids('project') } },
          select: { id: true, slug: true, title: true, description: true, content: true },
        }),
      ])
      const route = (key: string) => scope.modules.find((m) => m.key === key)!.route
      const rows = new Map([
        ...articles.map(
          (item) =>
            [
              'article:' + item.id,
              {
                title: item.title,
                content: item.summary || item.content,
                url: route('article') + '/' + item.slug,
              },
            ] as const,
        ),
        ...logsData.map(
          (item) =>
            [
              'log:' + item.id,
              {
                title: item.title,
                content: item.summary || item.content,
                url: route('log') + '/' + item.id,
              },
            ] as const,
        ),
        ...projectsData.map(
          (item) =>
            [
              'project:' + item.id,
              {
                title: item.title,
                content: item.description || item.content || '',
                url: route('portfolio') + '/' + item.slug,
              },
            ] as const,
        ),
      ])
      const safe = await applyPublicPrivacy(
        matches.map((match) => ({ ...match, ...rows.get(match.type + ':' + match.id)! })),
        tx,
      )
      return {
        data: safe.map(({ content, ...item }) => ({
          ...item,
          excerpt: highlightedExcerpt(content, query.q),
        })),
        meta: { ...pagination(query.page, query.pageSize, total), query: query.q, typeCounts },
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

/** 分类根包含直属子分类；归档只投影公开文章，不读草稿正文。 */
export async function getArticleArchive(
  kind: 'category' | 'tag',
  slug: string,
  params: URLSearchParams,
) {
  const query = parseSearchParams(
    new URLSearchParams({
      page: params.get('page') ?? '1',
      pageSize: params.get('pageSize') ?? '20',
    }),
  )
  return prisma.$transaction(
    async (tx) => {
      const scope = await publicContentScope(tx),
        column = scope.modules.find((m) => m.key === 'article' && m.enabled)
      const missing = () => new ApiError(404, 'NOT_FOUND', '归档不存在')
      if (!column) throw missing()
      const category =
        kind === 'category'
          ? await tx.category.findUnique({
              where: { slug },
              include: { children: { select: { id: true } } },
            })
          : null
      const record =
        category ?? (kind === 'tag' ? await tx.tag.findUnique({ where: { slug } }) : null)
      if (!record) throw missing()
      const where: Prisma.ArticleWhereInput = {
        ...scope.article,
        ...(kind === 'category'
          ? { categoryId: { in: [record.id, ...(category?.children.map((c) => c.id) ?? [])] } }
          : { tags: { some: { id: record.id } } }),
      }
      const total = await tx.article.count({ where })
      if (!total) throw missing()
      const items = await tx.article.findMany({
        where,
        orderBy: [{ isTop: 'desc' }, { order: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          publishedAt: true,
          readingTime: true,
          isTop: true,
        },
      })
      return applyPublicPrivacy(
        {
          title: record.name,
          description: category?.description ?? null,
          items,
          pagination: pagination(query.page, query.pageSize, total),
          currentRoute: column.route,
          url: column.route + '/' + kind + '/' + record.slug,
        },
        tx,
      )
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}
