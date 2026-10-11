import { safeContentUrl } from './markdown'

export const PROJECT_TYPES = {
  GAME: { label: '游戏', icon: '🎮' },
  REPO: { label: '代码库', icon: '📦' },
  SKILL: { label: 'Skills', icon: '⚡' },
  OTHER: { label: '其他', icon: '🔧' },
} as const
export const PROJECT_LINKS = {
  demo: '试玩 / 演示',
  github: '查看代码',
  docs: '文档',
  video: '视频',
  article: '相关文章',
} as const

/** 旧数据也只展示已知安全链接，不将任意JSON键当作链接按钮。 */
export function projectLinks(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const object = value as Record<string, unknown>
  return Object.entries(PROJECT_LINKS).flatMap(([key, label]) => {
    const url = typeof object[key] === 'string' ? safeContentUrl(object[key]) : null
    return url ? [{ key, label, url }] : []
  })
}
export function projectDate(value: string | Date | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        timeZone: 'Asia/Shanghai',
      }).format(date)
    : ''
}
