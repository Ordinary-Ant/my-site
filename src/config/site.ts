/**
 * 站点基础信息
 *
 * 注意：这里的值是"构建期兜底默认值"。
 * 运行期真正的站点名、描述、Logo、页脚等由数据库 Setting 表驱动，
 * 后台可改。见 docs/02-data-model.md §2.3、docs/04-admin-console.md §9
 */

export const siteConfig = {
  name: 'Puly 的站',
  shortName: 'Puly',
  description: '前端工程师 · 写代码也写字',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  locale: 'zh-CN',
  author: {
    name: 'Puly',
    email: 'hi@example.com',
  },
  /** 后台入口，写进 robots.txt 时用 */
  adminPath: '/admin',
} as const

export type SiteConfig = typeof siteConfig
