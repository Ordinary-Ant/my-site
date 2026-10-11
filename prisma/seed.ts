/**
 * 种子数据
 * 见 docs/02-data-model.md §6
 *
 * 目标：让 `npm run dev` 第一次跑起来就有内容可看，而不是空白页。
 *
 *   npm run db:migrate   # 建表
 *   npm run db:seed      # 灌数据
 *
 * 幂等：重复执行不会产生重复数据（用 upsert）。
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'

import { MODULE_KEYS, MODULE_REGISTRY } from '../src/config/modules'
import { DEFAULT_MOTION } from '../src/config/motion'
import { SEED_TAGS } from '../src/config/seed-taxonomy'

const prisma = new PrismaClient()

/** 新版编排默认无装饰，seed 不覆盖后台已有配置。 */
const MOTION_CONFIG = DEFAULT_MOTION as Prisma.InputJsonValue

const SETTINGS: { key: string; value: Prisma.InputJsonValue; group: string; label: string }[] = [
  { key: 'site.name', value: 'Puly 的站', group: 'general', label: '站点名称' },
  {
    key: 'site.description',
    value: '前端工程师 · 写代码也写字',
    group: 'general',
    label: '站点描述',
  },
  { key: 'site.logo', value: '/logo.svg', group: 'general', label: '站点 Logo' },
  { key: 'site.locale', value: 'zh-CN', group: 'general', label: '语言' },

  { key: 'theme.default', value: 'system', group: 'theme', label: '默认主题' },
  { key: 'theme.accent', value: '#6366F1', group: 'theme', label: '主题强调色' },

  {
    key: 'seo.defaultTitle',
    value: 'Puly 的站 · 前端工程师',
    group: 'seo',
    label: 'SEO 默认标题',
  },
  {
    key: 'seo.defaultDescription',
    value: '5 年经验前端工程师。这里记录我做过的东西和想明白的事。',
    group: 'seo',
    label: 'SEO 默认描述',
  },
  {
    key: 'seo.keywords',
    value: '前端,React,Next.js,TypeScript',
    group: 'seo',
    label: 'SEO 关键词',
  },

  { key: 'social.github', value: 'https://github.com/', group: 'social', label: 'GitHub' },
  { key: 'social.email', value: 'hi@example.com', group: 'social', label: '邮箱' },

  { key: 'footer.copyright', value: '© 2025 Puly', group: 'footer', label: '版权信息' },
  { key: 'footer.icp', value: '', group: 'footer', label: '备案号' },

  { key: 'motion.config', value: MOTION_CONFIG, group: 'motion', label: '动效配置' },
]

async function seedSettings() {
  for (const s of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {}, // 已存在则不动，避免覆盖你在后台改过的值
      create: { key: s.key, value: s.value, group: s.group, label: s.label },
    })
  }
  console.log(`  ✓ Setting × ${SETTINGS.length}`)
}

async function seedModules() {
  for (const key of MODULE_KEYS) {
    const def = MODULE_REGISTRY[key]
    const data = {
      name: def.name,
      description: def.description,
      route: def.route,
      icon: def.icon,
      navOrder: def.navOrder,
      navVisible: def.navVisible,
      isBuiltin: true,
      config: def.defaultConfig as Prisma.InputJsonValue,
    }
    await prisma.module.upsert({
      where: { key },
      update: {}, // 同上：不覆盖后台已调过的排序/开关
      create: { key, ...data },
    })
  }
  console.log(`  ✓ Module × ${MODULE_KEYS.length}`)
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com'
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123'
  const name = process.env.SEED_ADMIN_NAME ?? 'Puly'
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.SEED_ADMIN_PASSWORD || password === 'ChangeMe123')
  )
    throw new Error('生产 seed 必须提供独立管理员密码')

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name, role: 'ADMIN' },
  })

  console.log(`  ✓ User ${email}（角色 ${user.role}）`)
  if (password === 'ChangeMe123') {
    console.log('    ⚠ 仍在使用默认密码，首次登录后请立即修改')
  }
  return user
}

async function seedProfile() {
  await prisma.profile.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Puly',
      headline: '5 年经验前端工程师',
      bio: '## 你好\n\n我是一名前端工程师，关注工程化、性能与交互体验。\n\n这里记录我做过的东西，以及想明白的一些事。',
      email: 'hi@example.com',
      location: '杭州',
      jobTitle: '高级前端工程师',
      company: '某科技有限公司',
      yearsOfExp: 5,
      socials: [
        { platform: 'github', label: 'GitHub', url: 'https://github.com/', icon: 'github' },
        { platform: 'email', label: '邮箱', url: 'mailto:hi@example.com', icon: 'mail' },
      ],
      advantages: [
        {
          title: '工程化落地能力',
          description: '从 0 搭建设计系统、CI/CD 与代码规范体系，覆盖 12 条业务线',
          icon: 'wrench',
        },
        {
          title: '性能优化',
          description: '首屏 LCP 从 3.2s 优化到 1.1s；包体治理与监控体系建设',
          icon: 'zap',
        },
        {
          title: '交互与体验',
          description: '手感、动效、可访问性 —— 让功能真正好用',
          icon: 'palette',
        },
      ],
      skills: [
        {
          category: '前端框架',
          items: [
            { name: 'React', level: 5, years: 5 },
            { name: 'Vue', level: 3, years: 2 },
          ],
        },
        {
          category: '工程化',
          items: [
            { name: 'Vite', level: 4, years: 4 },
            { name: 'Webpack', level: 3, years: 3 },
          ],
        },
        {
          category: '后端',
          items: [{ name: 'Node.js', level: 3, years: 3 }],
        },
        {
          category: '语言',
          items: [{ name: 'TypeScript', level: 5, years: 5 }],
        },
      ],
      services: [
        {
          title: '技术咨询',
          description: '前端架构选型、性能优化方案评审',
          icon: 'message-circle',
        },
        { title: '合作机会', description: '接受远程 / 兼职的技术合作', icon: 'handshake' },
      ],
      contactVisible: true,
    },
  })
  console.log('  ✓ Profile × 1')
}

async function seedTaxonomy() {
  const categories = [
    { slug: 'tech', name: '技术', color: '#3B82F6', order: 1, description: '技术相关的长文' },
    { slug: 'life', name: '生活', color: '#8B5CF6', order: 2, description: '生活与思考' },
    { slug: 'essay', name: '随笔', color: '#F59E0B', order: 3, description: '不成体系的一些想法' },
  ]
  for (const c of categories) {
    await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: c })
  }

  const tags = SEED_TAGS
  for (const { name, slug } of tags) {
    await prisma.tag.upsert({ where: { slug }, update: {}, create: { name, slug } })
  }
  console.log(`  ✓ Category × ${categories.length} · Tag × ${tags.length}`)
}

async function seedContent(authorId: string) {
  const tech = await prisma.category.findUnique({ where: { slug: 'tech' } })
  const life = await prisma.category.findUnique({ where: { slug: 'life' } })

  const articles = [
    {
      slug: 'why-i-choose-nextjs',
      title: '我为什么选择 Next.js',
      summary: '从渲染模型到工程化的一次梳理，以及我在真实项目里踩过的坑。',
      content:
        '## 起因\n\n在过去的项目里，我一直在用不同的渲染方案。\n\n## 渲染模型\n\nRSC 带来的最大变化不是性能，而是心智模型。\n\n```tsx\nexport default function Page() {\n  return <div />\n}\n```\n\n## 结论\n\n工具是手段，不是目的。',
      status: 'PUBLISHED' as const,
      publishedAt: new Date('2025-01-15T00:00:00Z'),
      isTop: true,
      readingTime: 8,
      wordCount: 3200,
      viewCount: 1024,
      categoryId: tech?.id,
    },
    {
      slug: 'vite-build-optimization',
      title: 'Vite 构建优化实践',
      summary: '把构建时间从 40s 降到 8s，以及那些没写在文档里的细节。',
      content: '## 问题\n\nCI 一次构建要 40 秒。\n\n## 做法\n\n先测量，再优化。',
      status: 'PUBLISHED' as const,
      publishedAt: new Date('2025-01-14T00:00:00Z'),
      readingTime: 6,
      wordCount: 2100,
      viewCount: 320,
      categoryId: tech?.id,
    },
    {
      slug: 'thoughts-on-remote-work',
      title: '关于远程办公的思考',
      summary: '远程不是福利，是一种工作方式的重新设计。',
      content: '## 前提\n\n远程办公的前提是异步沟通能力。',
      status: 'PUBLISHED' as const,
      publishedAt: new Date('2025-01-12T00:00:00Z'),
      readingTime: 5,
      wordCount: 1800,
      viewCount: 210,
      categoryId: life?.id,
    },
  ]

  for (const a of articles) {
    await prisma.article.upsert({
      where: { slug: a.slug },
      update: {},
      create: { ...a, authorId },
    })
  }

  const logs = [
    {
      title: '重构了首页的动画',
      summary: '把 Framer Motion 换成了纯 CSS，包体小了 40KB。',
      content:
        '把 Framer Motion 换成了纯 CSS，包体小了 40KB。意外发现 scroll-driven animation 已经可以用了。',
      type: 'DAILY' as const,
      logDate: new Date('2025-01-15T00:00:00Z'),
      mood: 'happy',
      weather: 'sunny',
      location: '杭州',
      isPinned: false,
    },
    {
      title: '面试了一个候选人',
      summary: '聊到工程化的时候发现，很多人会用工具但说不清为什么用。',
      content:
        '聊到工程化的时候发现，很多人会用工具但说不清为什么用。这大概就是"经验"和"年限"的区别。',
      type: 'DAILY' as const,
      logDate: new Date('2025-01-14T00:00:00Z'),
      mood: 'calm',
      weather: 'cloudy',
      location: '杭州',
      isPinned: false,
    },
    {
      title: '读完《重构》第二遍',
      summary: '第二遍读感受完全不同，这次带着真实代码去读。',
      content: '第二遍读感受完全不同，这次带着真实代码去读，每一章都能对上号。',
      type: 'DAILY' as const,
      logDate: new Date('2025-01-12T00:00:00Z'),
      mood: 'excited',
      weather: 'rain',
      location: '杭州',
      isPinned: false,
    },
  ]

  for (const l of logs) {
    const exists = await prisma.log.findFirst({ where: { title: l.title } })
    if (!exists) await prisma.log.create({ data: { ...l, authorId, publishedAt: l.logDate } })
  }

  const projects: Prisma.ProjectCreateInput[] = [
    {
      slug: 'pixel-runner',
      title: 'Pixel Runner',
      subtitle: '用 Canvas 写的横版跑酷',
      description: '纯手写物理引擎的横版跑酷，无游戏框架依赖。',
      content:
        '## 项目亮点\n\n- 60fps 稳定运行，粒子与敌人用对象池管理\n- 手写 AABB 与胶囊体碰撞检测\n\n## 技术实现\n\n核心是一套极简的 ECS。',
      type: 'GAME' as const,
      techStack: ['TypeScript', 'Canvas', 'Vite'],
      role: '独立开发',
      highlights: ['60fps 稳定运行', '手写碰撞检测', '12 个关卡全部 JSON 配置'],
      links: { github: 'https://github.com/', demo: 'https://example.com/' },
      startDate: new Date('2024-09-01T00:00:00Z'),
      endDate: new Date('2024-12-01T00:00:00Z'),
      featured: true,
      order: 1,
    },
    {
      slug: 'design-system',
      title: '设计系统建设',
      subtitle: '从设计令牌到组件库到文档站',
      description: '完整落地一套可维护的设计系统，覆盖 12 条业务线。',
      type: 'SKILL' as const,
      techStack: ['Figma', 'Design Tokens', 'React'],
      role: '主导',
      highlights: ['45 个组件', '200+ 页文档', '12 条业务线接入', '复用率 78%'],
      // JSON 字段留空即可（写入 SQL NULL）。Prisma 不接受裸 null，
      // 显式置空需要 Prisma.DbNull —— 但那种情况这里用不到。
      featured: true,
      order: 2,
    },
  ]

  for (const p of projects) {
    await prisma.project.upsert({
      where: { slug: p.slug },
      update: {},
      create: { ...p, publishedAt: p.startDate ?? new Date() },
    })
  }
  console.log(
    `  ✓ Article × ${articles.length} · Log × ${logs.length} · Project × ${projects.length}`,
  )
}

async function seedTimeline() {
  const items = [
    {
      title: '高级前端工程师',
      subtitle: '商业化中台组',
      type: 'WORK' as const,
      organization: '某科技有限公司',
      location: '杭州',
      startDate: new Date('2023-03-01T00:00:00Z'),
      endDate: null as Date | null,
      isCurrent: true,
      tags: ['React', 'Node.js', '性能优化'],
      highlights: [
        '搭建公司级组件库，覆盖 12 条业务线，复用率 78%',
        '首屏 LCP 从 3.2s 优化到 1.1s',
        '推动前端监控覆盖率达 95%',
      ],
      order: 1,
    },
    {
      title: '前端工程师',
      type: 'WORK' as const,
      organization: '某公司',
      location: '北京',
      startDate: new Date('2021-06-01T00:00:00Z'),
      endDate: new Date('2023-02-01T00:00:00Z'),
      isCurrent: false,
      tags: ['Vue', 'Webpack'],
      highlights: ['负责核心交易链路前端', '把首屏资源体积减少 35%'],
      order: 1,
    },
    {
      title: '计算机科学与技术 · 本科',
      type: 'EDUCATION' as const,
      organization: '某大学',
      location: '武汉',
      startDate: new Date('2016-09-01T00:00:00Z'),
      endDate: new Date('2020-06-01T00:00:00Z'),
      isCurrent: false,
      tags: ['ACM'],
      highlights: ['GPA 3.7 / 4.0', '校 ACM 集训队成员'],
      order: 1,
    },
    {
      title: '全国大学生程序设计竞赛 · 银奖',
      type: 'AWARD' as const,
      organization: '中国大学生计算机设计大赛组委会',
      startDate: new Date('2019-11-01T00:00:00Z'),
      endDate: new Date('2019-11-01T00:00:00Z'),
      isCurrent: false,
      tags: ['算法'],
      highlights: [],
      order: 1,
    },
  ]

  for (const it of items) {
    const exists = await prisma.timelineItem.findFirst({
      where: { title: it.title, organization: it.organization },
    })
    if (!exists) await prisma.timelineItem.create({ data: it })
  }
  console.log(`  ✓ TimelineItem × ${items.length}`)
}

async function main() {
  console.log('\n🌱 开始灌入种子数据…\n')
  await seedSettings()
  await seedModules()
  const admin = await seedAdmin()
  await seedProfile()
  await seedTaxonomy()
  await seedContent(admin.id)
  await seedTimeline()
  console.log('\n✅ 种子数据完成。\n')
  console.log('   启动开发服务器：npm run dev')
  console.log('   登录后台：/login   （用上面输出的邮箱与密码）\n')
}

main()
  .catch((e) => {
    console.error('\n❌ 种子数据失败：\n', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
