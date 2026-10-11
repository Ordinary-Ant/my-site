import 'server-only'
import type { Module } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MODULE_KEYS, type ModuleKey, type ModuleConfig } from '@/config/modules'
import { DEFAULT_MOTION, motionSchema } from '@/config/motion'
import { siteConfig } from '@/config/site'
import { ApiError } from '@/lib/api/errors'
import { mergeModuleConfig } from '@/lib/validators/module'
import { readKnownSettings } from './settings'
import { scrubPublicContacts } from './public-privacy'
import { chinaToday } from '@/lib/log-display'
export { scrubPublicContacts } from './public-privacy'
const publicModule = (m: Module) => ({
  key: m.key as ModuleKey,
  name: m.name,
  description: m.description,
  enabled: m.enabled,
  navVisible: m.navVisible,
  navLabel: m.navLabel ?? m.name,
  icon: m.icon,
  route: m.route,
  navOrder: m.navOrder,
  config: mergeModuleConfig(m.key as ModuleKey, m.config, {}) as ModuleConfig,
})
export async function listVisibleModules() {
  return applyPublicPrivacy(
    (
      await prisma.module.findMany({
        where: { enabled: true, key: { in: [...MODULE_KEYS] } },
        orderBy: [{ navOrder: 'asc' }, { key: 'asc' }],
      })
    ).map(publicModule),
  )
}
/** 路径解析仍在服务端检查开关，middleware只负责历史地址跳转。 */
export async function requirePageModule(path: string | string[]) {
  const pathname = Array.isArray(path) ? `/${path.join('/')}` : path
  const m = (await prisma.module.findMany()).find((m) =>
    m.route === '/' ? pathname === '/' : pathname === m.route || pathname.startsWith(`${m.route}/`),
  )
  if (!m || !m.enabled || !MODULE_KEYS.includes(m.key as ModuleKey))
    throw new ApiError(404, 'MODULE_DISABLED', '栏目未开放')
  return publicModule(m)
}
/** 所有公开内容DTO复用联系方式边界，正文保留其余文字。 */
export async function applyPublicPrivacy<T>(value: T): Promise<T> {
  const [profile, about, contacts] = await Promise.all([
    prisma.profile.findUnique({ where: { id: 'default' } }),
    prisma.module.findUnique({ where: { key: 'about' } }),
    prisma.setting.findMany({ where: { key: { in: ['social.email', 'social.phone'] } } }),
  ])
  const config = about ? (mergeModuleConfig('about', about.config, {}) as ModuleConfig) : null
  if (profile?.contactVisible && about?.enabled && config?.sections?.contact !== false) return value
  return scrubPublicContacts(value, [
    profile?.email ?? '',
    profile?.phone ?? '',
    ...contacts.map((c) => (typeof c.value === 'string' ? c.value : '')),
  ]) as T
}
export async function getPublicSite() {
  const [settings, modules, p] = await Promise.all([
    readKnownSettings(),
    listVisibleModules(),
    prisma.profile.findUnique({ where: { id: 'default' } }),
  ])
  const about = modules.find((m) => m.key === 'about')
  const contact = !!about && p?.contactVisible === true && about.config.sections?.contact !== false
  const blocked = [
    p?.email ?? '',
    p?.phone ?? '',
    typeof settings.social?.['social.email'] === 'string' ? settings.social['social.email'] : '',
    typeof settings.social?.['social.phone'] === 'string' ? settings.social['social.phone'] : '',
  ]
  const group = (name: string) =>
    Object.fromEntries(
      Object.entries(settings[name] ?? {}).map(([k, v]) => [k.split('.').slice(1).join('.'), v]),
    )
  const general = group('general')
  let profile: Record<string, unknown> | null = p
    ? { name: p.name, headline: p.headline, avatar: p.avatar }
    : null
  if (p && about) {
    profile = {
      ...profile,
      ...(about.config.sections?.bio !== false ? { bio: p.bio } : {}),
      location: p.location,
      jobTitle: p.jobTitle,
      company: p.company,
      yearsOfExp: p.yearsOfExp,
      socials: p.socials,
      ...(about.config.sections?.advantages !== false ? { advantages: p.advantages } : {}),
      ...(about.config.sections?.skills !== false ? { skills: p.skills } : {}),
      ...(about.config.sections?.services !== false ? { services: p.services } : {}),
      ...(contact ? { email: p.email, phone: p.phone } : {}),
    }
  }
  const result = {
    site: {
      name: String(general.name ?? siteConfig.name),
      description: String(general.description ?? siteConfig.description),
      logo: general.logo ?? null,
      favicon: general.favicon ?? '/favicon.ico',
      locale: String(general.locale ?? 'zh-CN'),
      defaultTheme: group('theme').default ?? 'system',
      footer: group('footer'),
      social: group('social'),
    },
    seo: group('seo'),
    theme: group('theme'),
    motion: motionSchema.parse(settings.motion?.['motion.config'] ?? DEFAULT_MOTION),
    modules,
    profile,
  }
  if (contact) return result
  return scrubPublicContacts(result, blocked) as typeof result
}
export async function getHomeFeed() {
  const site = await getPublicSite()
  const sections = []
  const errors: ModuleKey[] = []
  for (const m of [...site.modules].sort(
    (a, b) =>
      (a.config.home?.order ?? 100) - (b.config.home?.order ?? 100) || a.key.localeCompare(b.key),
  )) {
    const home = m.config.home
    if (!home?.enabled || home.limit === 0) continue
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      publishedAt: { lte: new Date() },
    }
    const types = Object.entries(m.config.types ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
    let items: unknown[] = []
    try {
      if (m.key === 'article')
        items = await prisma.article.findMany({
          where,
          select: {
            id: true,
            title: true,
            slug: true,
            summary: true,
            coverImage: true,
            publishedAt: true,
            readingTime: true,
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: home.limit,
        })
      if (m.key === 'log')
        items = await prisma.log.findMany({
          where: {
            ...where,
            type: { in: types as ('DAILY' | 'EVENT' | 'SUMMARY')[] },
            OR: [{ logDate: { lte: new Date(chinaToday() + 'T00:00:00Z') } }, { isPinned: true }],
          },
          select: {
            id: true,
            title: true,
            summary: true,
            type: true,
            logDate: true,
            coverImage: true,
            publishedAt: true,
          },
          orderBy: [{ logDate: 'desc' }, { id: 'asc' }],
          take: home.limit,
        })
      if (m.key === 'portfolio')
        items = await prisma.project.findMany({
          where: {
            ...where,
            featured: true,
            type: { in: types as ('GAME' | 'REPO' | 'SKILL' | 'OTHER')[] },
          },
          select: {
            id: true,
            title: true,
            slug: true,
            subtitle: true,
            description: true,
            coverImage: true,
            type: true,
            techStack: true,
            highlights: true,
            links: true,
            startDate: true,
            endDate: true,
            featured: true,
          },
          orderBy: [
            { order: 'asc' },
            { startDate: { sort: 'desc', nulls: 'last' } },
            { id: 'asc' },
          ],
          take: home.limit,
        })
      if (m.key === 'timeline')
        items = await prisma.timelineItem.findMany({
          where: {
            visible: true,
            deletedAt: null,
            type: { in: types as ('WORK' | 'EDUCATION' | 'PROJECT' | 'AWARD' | 'MILESTONE')[] },
          },
          select: {
            id: true,
            title: true,
            type: true,
            startDate: true,
            endDate: true,
            startPrecision: true,
            endPrecision: true,
            isCurrent: true,
            organization: true,
          },
          orderBy: [
            { isCurrent: 'desc' },
            { startDate: m.config.direction ?? 'desc' },
            { order: 'asc' },
            { id: 'asc' },
          ],
          take: home.limit,
        })
      if (m.key === 'about' && site.profile) items = [site.profile]
      sections.push({ key: m.key, name: m.name, route: m.route, config: m.config, items })
    } catch {
      errors.push(m.key)
    }
  }
  if (errors.length && !sections.length)
    throw new ApiError(503, 'HOME_UNAVAILABLE', '首页内容暂时不可用')
  const result = { profile: site.profile, sections, errors }
  return applyPublicPrivacy(result)
}
