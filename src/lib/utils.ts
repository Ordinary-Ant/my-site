import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind 类名合并（shadcn 约定） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 中文友好的阅读时长估算：中文 300 字/分钟，英文 200 词/分钟 */
export function calcReadingTime(text: string): { wordCount: number; readingTime: number } {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const words = (text.match(/[a-zA-Z0-9]+/g) ?? []).length
  const wordCount = cjk + words
  const minutes = Math.ceil(cjk / 300 + words / 200)
  return { wordCount, readingTime: Math.max(1, minutes) }
}

/** 标题 → slug（中文转拼音需要额外依赖，未安装时退化为时间戳后缀） */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  // 纯中文标题无法直接作为 slug，交给调用方补后缀
  return /^[\w-]+$/.test(base) ? base : ''
}

/** 格式化日期为 YYYY-MM-DD（固定按 UTC+8，避免跨时区显示成前一天） */
export function formatDate(date: Date | string, withTime = false): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).formatToParts(d)

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  return withTime ? `${ymd} ${get('hour')}:${get('minute')}` : ymd
}

/** 取字符串的前 n 个字符作为摘要 */
export function excerpt(text: string, max = 120): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*>`~\-[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
