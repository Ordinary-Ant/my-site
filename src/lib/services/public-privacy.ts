import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
type MappedChar = { char: string; start: number; end: number }
const parser = unified().use(remarkParse).use(remarkGfm)
type SemanticNode = {
  type: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: SemanticNode[]
}
const ignoredContactChars = /[\s\u0000-\u0020\u007f-\u009f\u200b-\u200f\u202a-\u202e\ufeff]/
/** CommonMark转义只处理源码一次；双反斜杠及代码/HTML内不进行二次反转义。 */
function mappedMarkdown(value: string): MappedChar[] {
  const protectedSource = new Uint8Array(value.length)
  if (value.includes('\\')) {
    const mark = (node: SemanticNode) => {
      if (['code', 'inlineCode', 'html'].includes(node.type)) {
        const start = node.position?.start.offset,
          end = node.position?.end.offset
        if (start !== undefined && end !== undefined) protectedSource.fill(1, start, end)
      } else node.children?.forEach(mark)
    }
    mark(parser.parse(value))
  }
  const chars: MappedChar[] = []
  for (let index = 0; index < value.length; index++) {
    if (
      !protectedSource[index] &&
      value[index] === '\\' &&
      index + 1 < value.length &&
      /[!-/:-@\[-`{-~]/.test(value[index + 1])
    ) {
      chars.push({ char: value[index + 1], start: index, end: index + 2 })
      index++
    } else chars.push({ char: value[index], start: index, end: index + 1 })
  }
  return chars
}
/** 仅为检测解码，最终按原文坐标删去风险片段，代码及普通文字不重写。 */
function decodeContactChars(chars: MappedChar[]) {
  for (let pass = 0; pass < 8; pass++) {
    const source = chars.map((c) => c.char).join('')
    const next: MappedChar[] = []
    let cursor = 0
    let changed = false
    for (const match of source.matchAll(
      /%(?:25)*([0-7][0-9a-f])|&(?:#[0-9]{1,8}|#x[0-9a-f]{1,8}|[a-z][a-z0-9]{0,40});/gi,
    )) {
      const start = match.index!,
        end = start + match[0].length
      let decoded = match[0]
      if (match[1]) decoded = String.fromCharCode(parseInt(match[1], 16))
      else {
        const tree = parser.parse(match[0])
        const node = tree.children[0]
        if (
          node?.type === 'paragraph' &&
          node.children.length === 1 &&
          node.children[0].type === 'text'
        )
          decoded = node.children[0].value
      }
      for (let index = cursor; index < start; index++) next.push(chars[index])
      next.push(
        ...decoded
          .split('')
          .map((char) => ({ char, start: chars[start].start, end: chars[end - 1].end })),
      )
      cursor = end
      changed ||= decoded !== match[0]
    }
    for (let index = cursor; index < chars.length; index++) next.push(chars[index])
    chars = next
    if (!changed) break
  }
  return chars
}
function findContactRanges(chars: MappedChar[], blocked: string[]) {
  const visible = chars
    .filter((c) => !ignoredContactChars.test(c.char))
    .flatMap((c) =>
      c.char
        .toLowerCase()
        .split('')
        .map((char) => ({ ...c, char })),
    )
  const normalized = visible.map((c) => c.char).join('')
  const ranges: { start: number; end: number }[] = []
  for (const needle of [
    'mailto:',
    'tel:',
    ...blocked
      .map((s) =>
        s
          .split('')
          .filter((c) => !ignoredContactChars.test(c))
          .join('')
          .toLowerCase(),
      )
      .filter(Boolean),
  ]) {
    let index = 0
    while ((index = normalized.indexOf(needle, index)) !== -1) {
      ranges.push({ start: visible[index].start, end: visible[index + needle.length - 1].end })
      index += needle.length
    }
  }
  // 电话才忽略常见格式标点，邮箱仍保留有语义的连字符和括号。
  const punctuation = /[()（）\-‐‑‒–—―]/
  const phones = blocked.filter(
    (s) => /^[+\d\s()（）\-‐‑‒–—―]+$/.test(s) && s.replace(/\D/g, '').length >= 7,
  )
  const phoneChars = visible.filter((c) => !punctuation.test(c.char))
  const phoneText = phoneChars.map((c) => c.char).join('')
  for (const phone of phones) {
    const needle = phone
      .split('')
      .filter((c) => !ignoredContactChars.test(c) && !punctuation.test(c))
      .join('')
      .toLowerCase()
    let index = 0
    while ((index = phoneText.indexOf(needle, index)) !== -1) {
      ranges.push({
        start: phoneChars[index].start,
        end: phoneChars[index + needle.length - 1].end,
      })
      index += needle.length
    }
  }
  return { ranges, normalized }
}
/** 以渲染器的行内树串联文字，Markdown标记及链接目的地不混入可见文本。 */
function semanticContactRanges(value: string, blocked: string[]) {
  const ranges: { start: number; end: number }[] = []
  if (!/[\[*_~`]/.test(value)) return ranges
  const inline = (node: SemanticNode): MappedChar[] => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset
    if (start === undefined || end === undefined) return []
    if (node.type === 'text')
      return decodeContactChars(mappedMarkdown(value.slice(start, end))).map((c) => ({
        ...c,
        start: c.start + start,
        end: c.end + start,
      }))
    if (node.type === 'inlineCode') {
      const raw = value.slice(start, end)
      const fence = raw.match(/^`+/)?.[0].length ?? 0
      const chars = raw
        .slice(fence, raw.length - fence)
        .split('')
        .map((char, index) => ({
          char,
          start: start + fence + index,
          end: start + fence + index + 1,
        }))
      if (chars.length) {
        chars[0] = { ...chars[0], start }
        chars[chars.length - 1] = { ...chars[chars.length - 1], end }
      }
      return chars
    }
    if (node.children) {
      const chars: MappedChar[] = []
      for (const child of node.children) for (const char of inline(child)) chars.push(char)
      if (
        chars.length &&
        ['strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(node.type)
      ) {
        chars[0] = { ...chars[0], start }
        chars[chars.length - 1] = { ...chars[chars.length - 1], end }
      }
      return chars
    }
    // HTML源码和其他非文字节点保持分隔，不能反转义后拼成另一个邮箱。
    return [{ char: '\uffff', start, end }]
  }
  const walk = (node: SemanticNode) => {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const found = findContactRanges(inline(node), blocked)
      for (const range of found.ranges) ranges.push(range)
    } else node.children?.forEach(walk)
  }
  walk(parser.parse(value))
  return ranges
}
/** 仅为检测解码，最终按原文坐标删去风险片段，代码及普通文字不重写。 */
function contactRanges(value: string, blocked: string[]) {
  const found = findContactRanges(decodeContactChars(mappedMarkdown(value)), blocked)
  for (const range of semanticContactRanges(value, blocked)) found.ranges.push(range)
  return found
}
function eraseRanges(value: string, ranges: { start: number; end: number }[]) {
  const sorted = ranges.sort((a, b) => a.start - b.start)
  let cursor = 0,
    result = ''
  for (const range of sorted) {
    if (range.start > cursor) result += value.slice(cursor, range.start)
    cursor = Math.max(cursor, range.end)
  }
  return result + value.slice(cursor)
}
export function scrubPublicContacts(value: unknown, blocked: string[]): unknown {
  if (value instanceof Date) return value
  if (Array.isArray(value))
    return value.map((v) => scrubPublicContacts(v, blocked)).filter((v) => v !== undefined)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    const url = entries.find(([k, v]) => ['url', 'href'].includes(k) && typeof v === 'string')
    if (
      url &&
      entries.every(([key]) =>
        ['url', 'href', 'platform', 'label', 'icon', 'name', 'title'].includes(key),
      ) &&
      contactRanges(url[1] as string, blocked).ranges.length
    )
      return undefined
    return Object.fromEntries(
      entries
        .filter(([k]) => !['email', 'phone'].includes(k.toLowerCase()))
        .filter(([key, v]) => {
          if (
            typeof v !== 'string' ||
            [
              'content',
              'title',
              'slug',
              'key',
              'route',
              'summary',
              'description',
              'seoTitle',
              'seoDescription',
              'seoKeywords',
              'bio',
              'name',
              'headline',
            ].includes(key)
          )
            return true
          const risk = contactRanges(v, blocked)
          return !(risk.ranges.length && /^(?:https?:\/\/|mailto:|tel:)/.test(risk.normalized))
        })
        .map(([k, v]) => [k, scrubPublicContacts(v, blocked)])
        .filter(([, v]) => v !== undefined),
    )
  }
  if (typeof value === 'string') {
    const { ranges } = contactRanges(value, blocked)
    return ranges.length ? eraseRanges(value, ranges) : value
  }
  return value
}
