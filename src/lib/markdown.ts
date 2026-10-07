/** 正文URL仅允许HTTP(S)或规范站内路径，防止脚本协议和路径逃逸。 */
export function safeContentUrl(input: string | null | undefined): string | undefined {
  if (!input || /[\u0000-\u0020\\]/.test(input)) return undefined
  if (input.startsWith('/')) {
    if (input.startsWith('//')) return undefined
    try {
      const unsafe = input
        .split(/[?#]/)[0]
        .split('/')
        .some((segment) => {
          const decoded = decodeURIComponent(segment)
          return decoded === '.' || decoded === '..' || /[\u0000-\u0020/\\]/.test(decoded)
        })
      return unsafe ? undefined : input
    } catch {
      return undefined
    }
  }
  try {
    const url = new URL(input)
    return ['http:', 'https:'].includes(url.protocol) ? input : undefined
  } catch {
    return undefined
  }
}

/** 扩展语法/未知HTML/脚注/数学保留整文源码，避免富文本序列化丢结构。 */
export function markdownRequiresSource(source: string): boolean {
  const withoutCode = source.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '')
  return /(^|\n)\s*:::|<[^>]+>|\[\^|(^|\n)\s*\$\$|(^|\n)(?:#|#{5,6})\s/.test(withoutCode)
}

export type ContentBlock =
  | { type: 'markdown'; content: string }
  | { type: 'source'; content: string }
  | {
      type: 'tip' | 'warning' | 'details' | 'video' | 'card'
      title: string
      content: string
      url?: string
    }

type Fence = { character: string; length: number } | null
/** CommonMark围栏只被同字符、至少原长度且无附加文本的结束行关闭。 */
function nextFence(line: string, current: Fence): Fence {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  if (!match) return current
  if (!current) return { character: match[1][0], length: match[1].length }
  return match[1][0] === current.character && match[1].length >= current.length && !match[2].trim()
    ? null
    : current
}

/** 按围栏解析自定义块；未知块原样显示，代码围栏内不解释扩展指令。 */
export function parseContentBlocks(source: string): ContentBlock[] {
  const lines = source.split('\n')
  const blocks: ContentBlock[] = []
  let text: string[] = []
  let fence: Fence = null
  const flush = () => {
    if (text.length) blocks.push({ type: 'markdown', content: text.join('\n') })
    text = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenced = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenced) {
      fence = nextFence(line, fence)
      text.push(line)
      continue
    }
    if (fence || !/^:::[a-z]/i.test(line)) {
      text.push(line)
      continue
    }
    let end = i + 1
    let nestedFence: Fence = null
    for (; end < lines.length; end++) {
      nestedFence = nextFence(lines[end], nestedFence)
      if (!nestedFence && /^:::\s*$/.test(lines[end])) break
    }
    if (end === lines.length) {
      text.push(line)
      continue
    }
    flush()
    const standard = line.match(/^:::(tip|warning|details)(?:\[([^\]]*)\])?\s*$/)
    const media = line.match(/^:::(video|card)(?:\[([^\]]*)\])?\(([^)]+)\)\s*$/)
    const body = lines.slice(i + 1, end).join('\n')
    if (standard)
      blocks.push({
        type: standard[1] as 'tip' | 'warning' | 'details',
        title:
          standard[2] ??
          (standard[1] === 'warning' ? '注意' : standard[1] === 'tip' ? '提示' : '展开详情'),
        content: body,
      })
    else if (media && safeContentUrl(media[3]))
      blocks.push({
        type: media[1] as 'video' | 'card',
        title: media[2] ?? '查看内容',
        content: body,
        url: media[3],
      })
    else blocks.push({ type: 'source', content: lines.slice(i, end + 1).join('\n') })
    i = end
  }
  flush()
  return blocks
}

export function headingId(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  )
}

export type MarkdownNode = {
  type: string
  value?: string
  alt?: string | null
  depth?: number
  children?: MarkdownNode[]
  data?: { hProperties?: Record<string, unknown> }
}
/** 目录和正文共用可见标题文本，实体/引用链接不再生成不同锚点。 */
export function headingText(node: MarkdownNode): string {
  return node.value ?? node.alt ?? node.children?.map(headingText).join('') ?? ''
}
/** 同名标题与显式数字后缀共同检查已用ID，保证目录锚点全篇唯一。 */
export function createHeadingAllocator() {
  const used = new Set<string>()
  return (text: string) => {
    const base = headingId(text)
    let id = base
    let index = 1
    while (used.has(id)) id = `${base}-${index++}`
    used.add(id)
    return id
  }
}
