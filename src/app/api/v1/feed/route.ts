import { apiHandler, ok } from '@/lib/api/http'
import { getHomeFeed } from '@/lib/services/public-site'

/** 兼容文档约定的聚合流，数据与首页共用开关、公开过滤和联系方式边界。 */
export const GET = apiHandler(async () => {
  const { sections } = await getHomeFeed()
  const items = (key: string) => sections.find((section) => section.key === key)?.items ?? []
  return ok({
    featuredProjects: items('portfolio'),
    latestArticles: items('article'),
    latestLogs: items('log'),
    timelinePreview: items('timeline'),
  })
})
