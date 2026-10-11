import { z } from 'zod'
import { MODULE_REGISTRY, RESERVED_PATHS, type ModuleKey } from '@/config/modules'

const common = {
  pageSize: z.number().int().min(1).max(100).optional(),
  intro: z.string().max(1000).nullable().optional(),
  emptyText: z.string().max(500).nullable().optional(),
  home: z
    .object({
      enabled: z.boolean(),
      limit: z.number().int().min(0).max(20),
      order: z.number().int().min(0).max(100),
    })
    .strict()
    .optional(),
}
const switches = (keys: string[]) =>
  z
    .object(Object.fromEntries(keys.map((key) => [key, z.boolean()])))
    .strict()
    .optional()
const schemas = {
  home: z.object(common).strict(),
  article: z
    .object({
      ...common,
      showToc: z.boolean().optional(),
      showViewCount: z.boolean().optional(),
      relatedCount: z.number().int().min(0).max(10).optional(),
    })
    .strict(),
  log: z
    .object({
      ...common,
      defaultView: z.enum(['list', 'calendar']).optional(),
      types: switches(['DAILY', 'EVENT', 'SUMMARY']),
    })
    .strict(),
  portfolio: z
    .object({
      ...common,
      layout: z.enum(['grid', 'list']).optional(),
      showTechStack: z.boolean().optional(),
      types: switches(['GAME', 'REPO', 'SKILL', 'OTHER']),
    })
    .strict(),
  timeline: z
    .object({
      ...common,
      groupByYear: z.boolean().optional(),
      direction: z.enum(['asc', 'desc']).optional(),
      types: switches(['WORK', 'EDUCATION', 'PROJECT', 'AWARD', 'MILESTONE']),
    })
    .strict(),
  about: z
    .object({
      ...common,
      sections: switches(['bio', 'advantages', 'skills', 'experience', 'services', 'contact']),
    })
    .strict(),
}

/** 只递归普通对象；数组整体替换，危险键一律拒绝。合并后由严格合同校验。 */
export function mergeKnownObjects(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  if (Object.getPrototypeOf(patch) !== Object.prototype) throw new Error('配置必须是普通对象')
  const original =
    base && typeof base === 'object' && !Array.isArray(base)
      ? (base as Record<string, unknown>)
      : {}
  const result = { ...original }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('禁止危险配置键')
    result[key] = mergeKnownObjects(original[key], value)
  }
  return result
}

export function mergeModuleConfig(key: ModuleKey, current: unknown, patch: unknown) {
  const base = mergeKnownObjects(MODULE_REGISTRY[key].defaultConfig, current ?? {})
  return schemas[key].parse(mergeKnownObjects(base, patch))
}

/** 前缀也视为冲突，避免详情路径被另一个栏目遮蔽；历史地址永不转让。 */
export function validateModuleRoute(
  key: string,
  route: string,
  modules: { key: string; route: string }[],
  aliases: { moduleKey: string; path: string }[],
) {
  if (key === 'home') {
    if (route !== '/') throw new Error('首页路径固定')
    return '/'
  }
  if (!/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(route))
    throw new Error('路径仅支持小写英文、数字和连字符')
  const conflicts = (path: string) =>
    path === route || path.startsWith(`${route}/`) || route.startsWith(`${path}/`)
  const reserved = [
    ...RESERVED_PATHS.filter((path) => path !== '/'),
    '/archive',
    '/preview',
    '/uploads',
    '/health',
    '/favicon.ico',
    '/opengraph-image',
  ]
  if (
    reserved.some(conflicts) ||
    modules.some((m) => m.key !== key && m.route !== '/' && conflicts(m.route)) ||
    aliases.some((a) => a.moduleKey !== key && conflicts(a.path))
  )
    throw new Error('路径与系统、栏目或历史地址冲突')
  // 自己的旧地址也不能成为新地址的父子路径，否则后缀无法无歧义转换。
  if (
    modules.some(
      (m) => m.key === key && m.route !== route && m.route !== '/' && conflicts(m.route),
    ) ||
    aliases.some((a) => a.moduleKey === key && a.path !== route && conflicts(a.path))
  )
    throw new Error('路径与自己的历史地址嵌套')
  return route
}
