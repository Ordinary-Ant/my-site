/**
 * 模块注册表
 *
 * 这是代码侧的"模块清单"，与数据库 Module 表一一对应。
 * 后台只能改 Module 表里的 enabled / navLabel / navOrder / route / config；
 * key 与 isBuiltin 由这里定义，不可改。见 docs/01-architecture.md §7
 *
 * ⚠ 新增模块时：这里加一项 + seed 里加一行 + 建对应的 (site) 路由组。
 */

export const MODULE_KEYS = ['home', 'log', 'portfolio', 'timeline', 'article', 'about'] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

export interface ModuleDefinition {
  key: ModuleKey
  /** 默认显示名（后台可覆盖） */
  name: string
  description: string
  /** 前台路由（后台可改） */
  route: string
  /** lucide-react 图标名 */
  icon: string
  /** 默认导航顺序（后台可改） */
  navOrder: number
  /** 默认是否出现在导航（后台可改） */
  navVisible: boolean
  /** 是否可被后台关闭。home 不可关闭 —— 否则站点根路径 404 */
  canDisable: boolean
  /** 默认模块级配置，见 docs/01-architecture.md §7「config 规范结构」 */
  defaultConfig: ModuleConfig
}

/** Module.config 的规范结构 —— 全站唯一权威定义 */
export interface ModuleConfig {
  /** 列表每页条数 */
  pageSize?: number
  /** 栏目页顶部导语 */
  intro?: string | null
  /** 空态文案 */
  emptyText?: string | null
  /** 首页露出配置 */
  home?: {
    enabled: boolean
    limit: number
    order: number
  }
  /** 子类型级开关，键为该模块的类型枚举值 */
  types?: Record<string, boolean>
  /** log：默认视图 */
  defaultView?: 'list' | 'calendar'
  /** portfolio：卡片布局 */
  layout?: 'grid' | 'list'
  /** portfolio：卡片是否显示技术栈徽章 */
  showTechStack?: boolean
  /** article：详情页是否显示目录 */
  showToc?: boolean
  /** article：是否显示阅读量 */
  showViewCount?: boolean
  /** article：相关文章条数，0 表示不显示 */
  relatedCount?: number
  /** timeline：是否按年份分组 */
  groupByYear?: boolean
  /** timeline：排序方向 */
  direction?: 'desc' | 'asc'
  /** about：区块级开关 */
  sections?: {
    bio: boolean
    advantages: boolean
    skills: boolean
    experience: boolean
    services: boolean
    contact: boolean
  }
}

export const MODULE_REGISTRY: Record<ModuleKey, ModuleDefinition> = {
  home: {
    key: 'home',
    name: '首页',
    description: '聚合其他模块的精选内容',
    route: '/',
    icon: 'house',
    navOrder: 0,
    navVisible: false,
    canDisable: false,
    defaultConfig: {},
  },
  log: {
    key: 'log',
    name: '日志',
    description: '每日随笔、大事件、阶段总结',
    route: '/logs',
    icon: 'notebook-pen',
    navOrder: 1,
    navVisible: true,
    canDisable: true,
    defaultConfig: {
      pageSize: 10,
      intro: '记录每天发生的事，以及偶尔的顿悟',
      emptyText: '还没有日志',
      home: { enabled: true, limit: 5, order: 4 },
      defaultView: 'list',
      types: { DAILY: true, EVENT: true, SUMMARY: true },
    },
  },
  portfolio: {
    key: 'portfolio',
    name: '作品集',
    description: '游戏、代码库、Skills、个人制作',
    route: '/portfolio',
    icon: 'briefcase',
    navOrder: 2,
    navVisible: true,
    canDisable: true,
    defaultConfig: {
      pageSize: 12,
      intro: '做过的一些东西：游戏、工具、代码库，以及一些没什么用但很好玩的',
      emptyText: '还没有作品',
      home: { enabled: true, limit: 4, order: 2 },
      layout: 'grid',
      showTechStack: true,
      types: { GAME: true, REPO: true, SKILL: true, OTHER: true },
    },
  },
  timeline: {
    key: 'timeline',
    name: '时间戳',
    description: '学习与工作经历',
    route: '/timeline',
    icon: 'clock',
    navOrder: 3,
    navVisible: true,
    canDisable: true,
    defaultConfig: {
      intro: '从大学到现在，我走过的每一步',
      emptyText: '还没有记录',
      home: { enabled: false, limit: 3, order: 5 },
      groupByYear: true,
      direction: 'desc',
      types: { WORK: true, EDUCATION: true, PROJECT: true, AWARD: true, MILESTONE: true },
    },
  },
  article: {
    key: 'article',
    name: '文章',
    description: '正式对外发布的长文',
    route: '/articles',
    icon: 'file-text',
    navOrder: 4,
    navVisible: true,
    canDisable: true,
    defaultConfig: {
      pageSize: 10,
      intro: '认真写的一些东西',
      emptyText: '还没有文章',
      home: { enabled: true, limit: 5, order: 3 },
      showToc: true,
      showViewCount: true,
      relatedCount: 3,
    },
  },
  about: {
    key: 'about',
    name: '关于我',
    description: '个人基本信息、优势、工作经历',
    route: '/about',
    icon: 'user',
    navOrder: 5,
    navVisible: true,
    canDisable: true,
    defaultConfig: {
      intro: '我是谁，我在做什么，我擅长什么',
      home: { enabled: false, limit: 0, order: 6 },
      sections: {
        bio: true,
        advantages: true,
        skills: true,
        experience: true,
        services: true,
        contact: true,
      },
    },
  },
}

/** 保留路径：模块 route 不可与它们冲突 */
export const RESERVED_PATHS = [
  '/',
  '/admin',
  '/login',
  '/api',
  '/search',
  '/_next',
  '/sitemap.xml',
  '/robots.txt',
  '/rss.xml',
] as const

/** 首页区块的默认顺序（越小越靠前），用于后台拖拽排序的初始值 */
export const DEFAULT_HOME_ORDER: ModuleKey[] = ['portfolio', 'article', 'log', 'timeline']
