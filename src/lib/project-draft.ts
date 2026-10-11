import { PROJECT_LINKS, PROJECT_TYPES } from './project-display'

export type ProjectDraft = {
  title: string
  slug: string
  subtitle: string
  description: string
  content: string
  coverImage: string
  gallery: string[]
  type: keyof typeof PROJECT_TYPES
  techStack: string
  role: string
  highlights: string
  links: Record<keyof typeof PROJECT_LINKS, string>
  startDate: string
  endDate: string
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  featured: boolean
  publishedAt: string
  order: number
  tagIds: string[]
}
export const emptyProjectDraft = (): ProjectDraft => ({
  title: '',
  slug: '',
  subtitle: '',
  description: '',
  content: '',
  coverImage: '',
  gallery: [],
  type: 'REPO',
  techStack: '',
  role: '',
  highlights: '',
  links: { demo: '', github: '', docs: '', video: '', article: '' },
  startDate: '',
  endDate: '',
  status: 'PUBLISHED',
  featured: false,
  publishedAt: '',
  order: 0,
  tagIds: [],
})
const lines = (text: string) => [
  ...new Set(
    text
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
]
/** 网络正文只发送已知内容字段，空值与数组替换不能混成“未传”。 */
export function projectPayload(draft: ProjectDraft) {
  const links = Object.fromEntries(
    Object.entries(draft.links)
      .filter(([, value]) => value.trim())
      .map(([key, value]) => [key, value.trim()]),
  )
  return {
    title: draft.title.trim(),
    slug: draft.slug.trim(),
    subtitle: draft.subtitle || null,
    description: draft.description,
    content: draft.content || null,
    coverImage: draft.coverImage || null,
    gallery: [...draft.gallery],
    type: draft.type,
    techStack: lines(draft.techStack),
    role: draft.role || null,
    highlights: lines(draft.highlights),
    links: Object.keys(links).length ? links : null,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    status: draft.status,
    featured: draft.featured,
    publishedAt: draft.publishedAt || null,
    order: draft.order,
    tagIds: [...draft.tagIds],
  }
}
/** 完整ISO时间精度保留在稿件中；服务端ID/修订号不混入可编辑字段。 */
export function projectDraftFromRecord(record: Record<string, unknown>): ProjectDraft {
  const draft = emptyProjectDraft()
  const text = (value: unknown) =>
    value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : ''
  const array = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  for (const key of [
    'title',
    'slug',
    'subtitle',
    'description',
    'content',
    'coverImage',
    'role',
    'startDate',
    'endDate',
    'publishedAt',
  ] as const)
    draft[key] = text(record[key])
  if (typeof record.type === 'string' && record.type in PROJECT_TYPES)
    draft.type = record.type as ProjectDraft['type']
  if (['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(String(record.status)))
    draft.status = record.status as ProjectDraft['status']
  draft.gallery = array(record.gallery)
  draft.techStack = array(record.techStack).join('\n')
  draft.highlights = array(record.highlights).join('\n')
  draft.featured = record.featured === true
  draft.order = typeof record.order === 'number' ? record.order : 0
  draft.tagIds = Array.isArray(record.tags)
    ? record.tags.flatMap((tag) =>
        tag && typeof tag === 'object' && 'id' in tag && typeof tag.id === 'string' ? [tag.id] : [],
      )
    : []
  if (record.links && typeof record.links === 'object' && !Array.isArray(record.links))
    for (const key of Object.keys(PROJECT_LINKS) as (keyof typeof PROJECT_LINKS)[])
      draft.links[key] = text((record.links as Record<string, unknown>)[key])
  return draft
}
