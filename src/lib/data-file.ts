export const DATA_KINDS = [
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
export type DataKind = (typeof DATA_KINDS)[number]
export type DataCounts = Record<DataKind, number>
export type DataBundle = {
  version: '1.0'
  exportedAt: string
  data: Record<Exclude<DataKind, 'profile'>, unknown[]> & {
    profile: Record<string, unknown> | null
  }
}
export type DataReport = {
  mode: 'merge' | 'replace'
  created: DataCounts
  skipped: DataCounts
  replaces: DataCounts
  mapped: Partial<Record<DataKind, { from: string; to: string; reason: string }[]>>
  warnings: string[]
}
export type DataPreview = DataReport & { token: string; expiresAt: string }
export const DATA_LABELS: Record<DataKind, string> = {
  categories: '分类',
  tags: '标签',
  articles: '文章',
  logs: '日志',
  projects: '作品',
  timelineItems: '时间戳',
  modules: '栏目配置',
  settings: '站点设置',
  profile: '个人资料',
  routeAliases: '历史路径',
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
/** 浏览器只做文件元数据初筛；完整内容、关系和权限始终由服务端校验。 */
export function inspectDataFile(text: string): {
  bundle: DataBundle
  counts: DataCounts
  bytes: number
} {
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > 4_000_000) throw new Error('JSON文件超过4MB，请使用数据库和媒体备份。')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效JSON。')
  }
  if (!plain(value) || value.version !== '1.0')
    throw new Error('只支持version=1.0的导出文件，请核对版本。')
  if (
    Object.keys(value).some((key) => !['version', 'exportedAt', 'data'].includes(key)) ||
    typeof value.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    !plain(value.data) ||
    Object.keys(value.data).length !== DATA_KINDS.length
  )
    throw new Error('导出文件结构不完整或含未知字段。')
  const counts = {} as DataCounts
  for (const key of DATA_KINDS) {
    const item = value.data[key]
    if (key === 'profile') {
      if (item !== null && !plain(item)) throw new Error('个人资料结构不正确。')
      counts[key] = item === null ? 0 : 1
    } else {
      if (!Array.isArray(item)) throw new Error(DATA_LABELS[key] + '结构必须是数组。')
      counts[key] = item.length
    }
  }
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) > 5000)
    throw new Error('导入实体超过5000项，请使用数据库和媒体备份。')
  return { bundle: value as DataBundle, counts, bytes }
}
/** 影响报告允许下载，预览凭证只留内存，不能随报告落盘。 */
export function dataReportWithoutToken<
  T extends Pick<DataReport, 'mode' | 'created' | 'skipped' | 'replaces' | 'mapped' | 'warnings'>,
>(value: T): DataReport {
  return {
    mode: value.mode,
    created: value.created,
    skipped: value.skipped,
    replaces: value.replaces,
    mapped: value.mapped,
    warnings: value.warnings,
  }
}
