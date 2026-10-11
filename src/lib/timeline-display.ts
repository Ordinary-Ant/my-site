export type DatePrecision = 'YEAR' | 'MONTH' | 'DAY'
export const TIMELINE_TYPES = {
  WORK: { label: '工作', icon: '💼', color: '#3b82f6' },
  EDUCATION: { label: '教育', icon: '🎓', color: '#10b981' },
  PROJECT: { label: '项目', icon: '🛠', color: '#8b5cf6' },
  AWARD: { label: '荣誉', icon: '🏆', color: '#f59e0b' },
  MILESTONE: { label: '里程碑', icon: '🚩', color: '#f97316' },
} as const
/** 时间线保存日历日期，显示不经本机时区转换，也不补出缺失精度。 */
export function timelineInputDate(date: string | Date | null, precision: DatePrecision) {
  if (!date) return ''
  const value = date instanceof Date ? date.toISOString() : date
  return value.slice(0, precision === 'YEAR' ? 4 : precision === 'MONTH' ? 7 : 10)
}
export function timelineDate(date: string | Date | null, precision: DatePrecision) {
  const value = timelineInputDate(date, precision)
  return value ? (precision === 'YEAR' ? value + ' 年' : value.replaceAll('-', '.')) : ''
}
export type TimelineItem = {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  type: keyof typeof TIMELINE_TYPES
  organization: string | null
  location: string | null
  startDate: string | Date
  endDate: string | Date | null
  startPrecision: DatePrecision
  endPrecision: DatePrecision
  isCurrent: boolean
  logo: string | null
  tags: string[]
  highlights: string[]
  order: number
  visible: boolean
  showOnAbout: boolean
  revision: number
}
