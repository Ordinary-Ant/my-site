import { z } from 'zod'
import { ArticleCreateSchema } from './article'
import { LogCreateSchema } from './log'
import { ProjectCreateSchema } from './project'
import { TimelineUpdateSchema, normalizeTimelineDate } from './timeline'
import { CategoryCreateSchema, TagCreateSchema } from './taxonomy'
import { ProfileSchema, profileBirthdaySchema } from './profile'
import { MODULE_KEYS, type ModuleKey } from '@/config/modules'
import { mergeModuleConfig, validateModuleRoute } from './module'
import { settingGroups, type SettingGroup } from './settings'
import { motionSchema } from '@/config/motion'

const id = z.string().cuid()
const date = z
  .string()
  .datetime({ offset: true })
  .refine((v) => {
    const day = v.slice(0, 10),
      parsed = new Date(day + 'T00:00:00Z')
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  }, '无效日历日期')
const rev = z.number().int().min(1).max(2147483646)
const count = z.number().int().min(0).max(2147483647)
const timestamps = { createdAt: date, updatedAt: date }
const contentMeta = { id, ...timestamps, deletedAt: date.nullable(), revision: rev }
// 编辑DTO的default不能将不完整备份静默补齐；导入必须提供所有导出字段。
function fullFields<T extends z.AnyZodObject>(schema: T): T {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    let required = field as z.ZodTypeAny
    while (required instanceof z.ZodDefault || required instanceof z.ZodOptional)
      required = required instanceof z.ZodDefault ? required.removeDefault() : required.unwrap()
    shape[key] = required
  }
  return z.object(shape).strict() as unknown as T
}
const fullMotionSchema = fullFields(motionSchema)
const article = fullFields(ArticleCreateSchema.required())
  .extend({
    ...contentMeta,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    publishedAt: date.nullable(),
    authorId: id.nullable(),
    readingTime: count,
    wordCount: count,
    viewCount: count,
    likeCount: count,
  })
  .strict()
const log = fullFields(LogCreateSchema.required())
  .extend({
    ...contentMeta,
    publishedAt: date.nullable(),
    authorId: id.nullable(),
    viewCount: count,
  })
  .strict()
const project = fullFields(ProjectCreateSchema.innerType().required())
  .extend({
    ...contentMeta,
    startDate: date.nullable(),
    endDate: date.nullable(),
    publishedAt: date.nullable(),
    viewCount: count,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && new Date(v.endDate) < new Date(v.startDate))
      ctx.addIssue({ code: 'custom', message: '作品日期倒序' })
  })
const timeline = fullFields(TimelineUpdateSchema.innerType().innerType().required())
  .extend({ ...contentMeta, startDate: date, endDate: date.nullable() })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of ['startDate', 'endDate'] as const) {
      const value = v[key]
      if (value === null) continue
      const year = Number(value.slice(0, 4)),
        precision = key === 'startDate' ? v.startPrecision : v.endPrecision
      if (
        year < 1 ||
        year > 9998 ||
        !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,3})?Z$/.test(value) ||
        new Date(value).getTime() !== normalizeTimelineDate(value, precision).getTime()
      )
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: '经历日期须为0001–9998年且与日期精度一致的UTC零时',
        })
    }
    if ((v.endDate && new Date(v.endDate) < new Date(v.startDate)) || (v.isCurrent && v.endDate))
      ctx.addIssue({ code: 'custom', message: '经历日期错误' })
  })
const category = fullFields(CategoryCreateSchema.required())
  .extend({ id, ...timestamps, revision: rev })
  .strict()
const tag = fullFields(TagCreateSchema.required())
  .extend({ id, createdAt: date, revision: rev })
  .strict()
const profile = fullFields(ProfileSchema.required())
  .extend({
    id: z.literal('default'),
    birthday: date
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,3})?Z$/.test(value) &&
          profileBirthdaySchema.safeParse(value.slice(0, 10)).success,
        '生日须为0001–9998年有效日历日期的UTC零时',
      )
      .nullable(),
    updatedAt: date,
    revision: rev,
  })
  .strict()
const moduleSchema = z
  .object({
    key: z.enum(MODULE_KEYS),
    name: z.string().min(1).max(40),
    description: z.string().max(1000).nullable(),
    enabled: z.boolean(),
    navVisible: z.boolean(),
    navLabel: z.string().max(40).nullable(),
    navOrder: z.number().int().min(0).max(100),
    icon: z.string().max(80).nullable(),
    route: z.string(),
    config: z.record(z.unknown()).nullable(),
    isBuiltin: z.literal(true),
    updatedAt: date,
  })
  .strict()
const alias = z
  .object({ path: z.string(), moduleKey: z.enum(MODULE_KEYS), createdAt: date })
  .strict()
const setting = z
  .object({
    key: z.string(),
    value: z.unknown().refine((value) => value !== undefined, '必须包含value'),
    group: z.enum(Object.keys(settingGroups) as [SettingGroup, ...SettingGroup[]]),
    label: z.string().max(500).nullable(),
    updatedAt: date,
    updatedBy: z.string().nullable(),
  })
  .strict()
export const DATA_KEYS = [
  'categories',
  'tags',
  'articles',
  'logs',
  'projects',
  'timelineItems',
  'modules',
  'settings',
  'profile',
  'routeAliases',
] as const
export function rejectDangerousKeys(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }],
    seen = new Set<object>()
  let nodes = 0
  while (stack.length) {
    const { value: current, depth } = stack.pop()!
    if (++nodes > 500000 || depth > 100) return false
    if (!current || typeof current !== 'object') continue
    if (seen.has(current)) return false
    seen.add(current)
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype) return false
    for (const [key, v] of Object.entries(current)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false
      stack.push({ value: v, depth: depth + 1 })
    }
  }
  return true
}
export const DataBundleSchema = z
  .object({
    version: z.literal('1.0'),
    exportedAt: date,
    data: z
      .object({
        modules: z.array(moduleSchema),
        routeAliases: z.array(alias),
        settings: z.array(setting),
        profile: profile.nullable(),
        categories: z.array(category),
        tags: z.array(tag),
        articles: z.array(article),
        logs: z.array(log),
        projects: z.array(project),
        timelineItems: z.array(timeline),
      })
      .strict(),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    const d = bundle.data
    if (!rejectDangerousKeys(bundle)) fail('危险键')
    for (const key of DATA_KEYS) {
      if (key === 'profile') continue
      const rows = d[key] as Array<{ id?: string; slug?: string; key?: string; path?: string }>
      for (const field of ['id', 'slug', 'key', 'path'] as const) {
        const values = rows.map((r) => r[field]).filter((v) => v !== undefined)
        if (new Set(values).size !== values.length) fail(`${key}.${field}重复`)
      }
    }
    if (
      d.modules.length !== MODULE_KEYS.length ||
      !MODULE_KEYS.every((k) => d.modules.some((m) => m.key === k))
    )
      fail('必须包含所有模块')
    const cats = new Map(d.categories.map((c) => [c.id, c])),
      tags = new Set(d.tags.map((t) => t.id))
    for (const c of d.categories)
      if (
        c.parentId &&
        (!cats.has(c.parentId) || cats.get(c.parentId)?.parentId || c.parentId === c.id)
      )
        fail('分类只能两层且父分类必须存在')
    for (const row of [...d.articles, ...d.logs, ...d.projects]) {
      if (row.tagIds.some((t) => !tags.has(t)) || new Set(row.tagIds).size !== row.tagIds.length)
        fail('标签关系不存在或重复')
      if ('categoryId' in row && row.categoryId && !cats.has(row.categoryId)) fail('分类关系不存在')
    }
    for (const s of d.settings) {
      try {
        settingGroups[s.group].parse({ [s.key]: s.value })
        if (s.key === 'motion.config') fullMotionSchema.parse(s.value)
      } catch {
        fail(`设置不合法:${s.key}`)
      }
    }
    if (d.profile) {
      const { id: _, updatedAt: __, revision: ___, ...p } = d.profile
      void _
      void __
      void ___
      if (!ProfileSchema.safeParse({ ...p, birthday: p.birthday?.slice(0, 10) ?? null }).success)
        fail('档案不合法')
    }
    try {
      for (const m of d.modules) {
        mergeModuleConfig(m.key as ModuleKey, null, m.config ?? {})
        validateModuleRoute(m.key, m.route, d.modules, d.routeAliases)
        if (m.key === 'home' && !m.enabled) throw Error()
      }
      for (const a of d.routeAliases) {
        const current = d.modules.find((m) => m.route === a.path)
        if (current?.key === a.moduleKey) continue
        if (current) throw Error()
        validateModuleRoute(
          a.moduleKey,
          a.path,
          d.modules,
          d.routeAliases.filter((x) => x.path !== a.path),
        )
      }
    } catch {
      fail('模块配置或历史路径不合法')
    }
  })
export type DataBundle = z.infer<typeof DataBundleSchema>
export const ImportPreviewSchema = z
  .object({ mode: z.enum(['merge', 'replace']), bundle: DataBundleSchema })
  .strict()
export const ImportSchema = ImportPreviewSchema.extend({
  token: z.string().min(1).max(4000),
  confirmation: z.string().optional(),
})
  .strict()
  .refine((v) => v.mode !== 'replace' || v.confirmation === '替换全部内容', '请输入替换全部内容')
