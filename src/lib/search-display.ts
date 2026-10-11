import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

type TextNode = { type: string; value?: string; alt?: string | null; children?: TextNode[] }
const parser = unified().use(remarkParse).use(remarkGfm)
/** 解析Markdown后取可见文字，链接地址和HTML标签不进入摘要。 */
export function plainSearchText(value: string): string {
  const text = (node: TextNode): string => {
    if (node.type === 'html') return ''
    if (node.type === 'image') return node.alt ?? ''
    if (node.value !== undefined) return node.value
    const joiner = ['root', 'list', 'listItem'].includes(node.type) ? ' ' : ''
    return (
      (node.children ?? []).map(text).join(joiner) +
      (['paragraph', 'heading', 'code', 'break'].includes(node.type) ? ' ' : '')
    )
  }
  return text(parser.parse(value.replace(/<[^>]*>/g, '')))
    .replace(/\s+/g, ' ')
    .trim()
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function highlightedExcerpt(value: string, query: string): string {
  const source = plainSearchText(value)
  const index = query ? source.toLowerCase().indexOf(query.toLowerCase()) : -1
  const start = Math.max(0, index - 60),
    end = Math.min(source.length, start + 220)
  const snippet = source.slice(start, end)
  let result = '',
    cursor = 0
  if (query) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    for (const match of snippet.matchAll(pattern)) {
      result += escape(snippet.slice(cursor, match.index)) + '<em>' + escape(match[0]) + '</em>'
      cursor = match.index + match[0].length
    }
  }
  return (
    (start ? '…' : '') + result + escape(snippet.slice(cursor)) + (end < source.length ? '…' : '')
  )
}
/** 仅识别本服务生成的固定em；解码后始终交给React文本节点。 */
export function searchHighlightParts(value: string): { text: string; highlight: boolean }[] {
  const decode = (s: string) =>
    s.replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!,
    )
  return value
    .split(/(<em>.*?<\/em>)/g)
    .filter(Boolean)
    .map((part) => ({
      text: decode(part.startsWith('<em>') ? part.slice(4, -5) : part),
      highlight: part.startsWith('<em>'),
    }))
}
