import { timelineInputDate, type DatePrecision, type TIMELINE_TYPES } from './timeline-display'
export type TimelineDraft = {
  title: string
  subtitle: string
  description: string
  type: keyof typeof TIMELINE_TYPES
  organization: string
  location: string
  startDate: string
  endDate: string
  startPrecision: DatePrecision
  endPrecision: DatePrecision
  isCurrent: boolean
  logo: string
  tags: string
  highlights: string
  order: number
  visible: boolean
  showOnAbout: boolean
}
export const emptyTimelineDraft = (): TimelineDraft => ({
  title: '',
  subtitle: '',
  description: '',
  type: 'WORK',
  organization: '',
  location: '',
  startDate: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7),
  endDate: '',
  startPrecision: 'MONTH',
  endPrecision: 'MONTH',
  isCurrent: false,
  logo: '',
  tags: '',
  highlights: '',
  order: 0,
  visible: true,
  showOnAbout: true,
})
const lines = (value: string) => [
  ...new Set(
    value
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
]
export function changeTimelinePrecision(value: string, precision: DatePrecision) {
  if (!value) return ''
  const expanded =
    value.length === 4 ? value + '-01-01' : value.length === 7 ? value + '-01' : value
  return timelineInputDate(expanded, precision)
}
/** 仅提交可编辑字段，空值明确清空；内部id/revision不进入表单稿件。 */
export function timelinePayload(draft: TimelineDraft) {
  return {
    title: draft.title.trim(),
    subtitle: draft.subtitle || null,
    description: draft.description || null,
    type: draft.type,
    organization: draft.organization || null,
    location: draft.location || null,
    startDate: draft.startDate,
    endDate: draft.endDate || null,
    startPrecision: draft.startPrecision,
    endPrecision: draft.endPrecision,
    isCurrent: draft.isCurrent,
    logo: draft.logo || null,
    tags: lines(draft.tags),
    highlights: lines(draft.highlights),
    order: draft.order,
    visible: draft.visible,
    showOnAbout: draft.showOnAbout,
  }
}
export function timelineDraftFromRecord(record: Record<string, unknown>): TimelineDraft {
  const draft = emptyTimelineDraft(),
    text = (value: unknown) => (typeof value === 'string' ? value : '')
  for (const key of [
    'title',
    'subtitle',
    'description',
    'organization',
    'location',
    'logo',
  ] as const)
    draft[key] = text(record[key])
  if (['WORK', 'EDUCATION', 'PROJECT', 'AWARD', 'MILESTONE'].includes(String(record.type)))
    draft.type = record.type as TimelineDraft['type']
  for (const key of ['startPrecision', 'endPrecision'] as const)
    if (['YEAR', 'MONTH', 'DAY'].includes(String(record[key])))
      draft[key] = record[key] as DatePrecision
  for (const key of ['startDate', 'endDate'] as const)
    draft[key] = timelineInputDate(
      record[key] instanceof Date ? record[key] : text(record[key]),
      key === 'startDate' ? draft.startPrecision : draft.endPrecision,
    )
  for (const key of ['tags', 'highlights'] as const)
    draft[key] = Array.isArray(record[key])
      ? record[key].filter((value) => typeof value === 'string').join('\n')
      : ''
  for (const key of ['visible', 'showOnAbout', 'isCurrent'] as const)
    if (typeof record[key] === 'boolean') draft[key] = record[key]
  if (typeof record.order === 'number') draft.order = record.order
  return draft
}
